import {
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User } from './entities/user.entity';
import { UserRole } from './user-role.enum';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { DEFAULT_PAGE_LIMIT } from 'src/shared/pagination';

const BCRYPT_ROUNDS = 10;

const USER_ROLE_VALUES = new Set<string>(Object.values(UserRole));

// Parses the role at the boundary: the generated zod schema guarantees the
// input is one of 'admin' | 'moderator' | 'user', and this maps it to the
// trusted internal UserRole enum (the literal union is not assignable to it).
function toUserRole(role: string | undefined): UserRole {
  if (role === undefined) {
    return UserRole.User;
  }
  if (!USER_ROLE_VALUES.has(role)) {
    throw new Error(`Unknown user role: ${role}`);
  }
  return role as UserRole;
}

export interface UserResponse {
  id: string;
  name: string;
  username: string;
  email: string;
  role: UserRole;
}

export interface AllUsersResponse {
  users: UserResponse[];
  count: number;
}

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private usersRepository: Repository<User>,
    @InjectDataSource()
    private dataSource: DataSource,
  ) {}

  async findOneByUsername(username: string): Promise<User | null> {
    try {
      return await this.usersRepository.findOne({ where: { username } });
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        'from:findOneByUsername ' + error.message,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async findOneById(id: string): Promise<User | null> {
    try {
      return await this.usersRepository.findOne({ where: { id } });
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        'from:findOneById ' + error.message,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async updatePassword(id: string, hashedPassword: string): Promise<void> {
    await this.usersRepository.update(id, { password: hashedPassword });
  }

  async findAll(page?: number, limit?: number): Promise<AllUsersResponse> {
    try {
      // Offset mode is selected by the presence of page/limit (limit without
      // page means page 1). The full fetch keeps the same deterministic
      // id-DESC order (newest first) and reports the total as count.
      const offsetMode = page !== undefined || limit !== undefined;
      const effectivePage = page ?? 1;
      const effectiveLimit = limit ?? DEFAULT_PAGE_LIMIT;
      const [users, count] = await this.usersRepository.findAndCount(
        offsetMode
          ? {
              order: { id: 'DESC' },
              skip: (effectivePage - 1) * effectiveLimit,
              take: effectiveLimit,
            }
          : { order: { id: 'DESC' } },
      );
      return { users: users.map((user) => this.toResponse(user)), count };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        'from:findAll ' + error.message,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async findOne(id: string): Promise<UserResponse> {
    try {
      const user = await this.usersRepository.findOne({ where: { id } });
      if (!user) {
        throw new NotFoundException('Пользователь не найден');
      }
      return this.toResponse(user);
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        'from:findOne ' + error.message,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async create(dto: CreateUserDto): Promise<UserResponse> {
    try {
      const hashedPassword = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
      const user = this.usersRepository.create({
        name: dto.name,
        email: dto.email,
        username: dto.username,
        password: hashedPassword,
        role: toUserRole(dto.role),
      });
      const saved = await this.usersRepository.save(user);
      return this.toResponse(saved);
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      if (this.isUniqueViolation(error)) {
        throw new ConflictException(
          'Пользователь с таким email или username уже существует',
        );
      }
      throw new HttpException(
        'from:create ' + error.message,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async update(
    id: string,
    dto: UpdateUserDto,
    currentUserId: string,
  ): Promise<UserResponse> {
    try {
      const nextRole =
        dto.role === undefined ? undefined : toUserRole(dto.role);

      // Self-demotion is blocked outright: nobody may take away their own role.
      if (nextRole !== undefined && id === currentUserId) {
        throw new ForbiddenException('Нельзя изменить свою роль');
      }

      // SERIALIZABLE isolation prevents the concurrent last-admin race: two
      // admins demoting each other would both see the old admin count under
      // READ COMMITTED, leaving zero admins behind.
      return await this.dataSource.transaction(
        'SERIALIZABLE',
        async (manager: EntityManager) => {
          const user = await manager.findOne(User, { where: { id } });
          if (!user) {
            throw new NotFoundException('Пользователь не найден');
          }

          // Demoting the last remaining admin would lock the system out.
          if (
            nextRole !== undefined &&
            user.role === UserRole.Admin &&
            nextRole !== UserRole.Admin &&
            (await this.countAdmins(manager)) <= 1
          ) {
            throw new ForbiddenException(
              'Нельзя понизить последнего администратора',
            );
          }

          if (dto.name !== undefined) {
            user.name = dto.name;
          }
          if (dto.email !== undefined) {
            user.email = dto.email;
          }
          if (dto.username !== undefined) {
            user.username = dto.username;
          }
          if (nextRole !== undefined) {
            user.role = nextRole;
          }

          const saved = await manager.save(user);
          return this.toResponse(saved);
        },
      );
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      if (this.isUniqueViolation(error)) {
        throw new ConflictException(
          'Пользователь с таким email или username уже существует',
        );
      }
      throw new HttpException(
        'from:update ' + error.message,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async changePassword(id: string, dto: ChangePasswordDto): Promise<void> {
    try {
      const user = await this.usersRepository.findOne({ where: { id } });
      if (!user) {
        throw new NotFoundException('Пользователь не найден');
      }
      const hashedPassword = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
      await this.updatePassword(id, hashedPassword);
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        'from:changePassword ' + error.message,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async remove(id: string, currentUserId: string): Promise<void> {
    try {
      if (id === currentUserId) {
        throw new ForbiddenException('Нельзя удалить собственный аккаунт');
      }

      // SERIALIZABLE isolation prevents the concurrent last-admin race: two
      // admins removing each other would both see the old admin count under
      // READ COMMITTED, leaving zero admins behind.
      await this.dataSource.transaction(
        'SERIALIZABLE',
        async (manager: EntityManager) => {
          const user = await manager.findOne(User, { where: { id } });
          if (!user) {
            throw new NotFoundException('Пользователь не найден');
          }

          // Removing the last admin would lock the system out.
          if (
            user.role === UserRole.Admin &&
            (await this.countAdmins(manager)) <= 1
          ) {
            throw new ForbiddenException(
              'Нельзя удалить последнего администратора',
            );
          }

          await manager.delete(User, id);
        },
      );
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        'from:remove ' + error.message,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  private async countAdmins(manager: EntityManager): Promise<number> {
    return manager.count(User, { where: { role: UserRole.Admin } });
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === '23505'
    );
  }

  private toResponse(user: User): UserResponse {
    return {
      id: user.id,
      name: user.name,
      username: user.username,
      email: user.email,
      role: user.role,
    };
  }
}

import {
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User } from './entities/user.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ChangePasswordDto } from './dto/change-password.dto';

const BCRYPT_ROUNDS = 10;

export interface UserResponse {
  id: string;
  name: string;
  username: string;
  email: string;
}

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private usersRepository: Repository<User>,
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

  async findAll(): Promise<UserResponse[]> {
    try {
      const users = await this.usersRepository.find();
      return users.map((user) => this.toResponse(user));
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

  async update(id: string, dto: UpdateUserDto): Promise<UserResponse> {
    try {
      const user = await this.usersRepository.findOne({ where: { id } });
      if (!user) {
        throw new NotFoundException('Пользователь не найден');
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

      const user = await this.usersRepository.findOne({ where: { id } });
      if (!user) {
        throw new NotFoundException('Пользователь не найден');
      }

      const total = await this.usersRepository.count();
      if (total <= 1) {
        throw new ForbiddenException(
          'Нельзя удалить последнего администратора',
        );
      }

      await this.usersRepository.delete(id);
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
    };
  }
}

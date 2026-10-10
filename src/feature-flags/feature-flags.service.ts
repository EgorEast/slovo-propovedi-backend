import {
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { FeatureFlag } from './entities/feature-flag.entity';
import {
  FeatureFlagOverride,
  FeatureFlagOverrideValue,
} from './entities/feature-flag-override.entity';
import { CreateFeatureFlagDto } from './dto/create-feature-flag.dto';
import { UpdateFeatureFlagDto } from './dto/update-feature-flag.dto';

export interface FeatureFlagResponse {
  id: string;
  key: string;
  title: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface FeatureFlagListResponse {
  flags: FeatureFlagResponse[];
}

export interface EffectiveFeatureFlag {
  key: string;
  enabled: boolean;
}

export interface EffectiveFeatureFlagListResponse {
  flags: EffectiveFeatureFlag[];
}

export interface FeatureFlagOverrideResponse {
  flagId: string;
  userId: string;
  value: FeatureFlagOverrideValue;
  createdAt: string;
}

export interface FeatureFlagOverrideListResponse {
  overrides: FeatureFlagOverrideResponse[];
}

@Injectable()
export class FeatureFlagsService {
  constructor(
    @InjectRepository(FeatureFlag)
    private readonly flagsRepository: Repository<FeatureFlag>,
    @InjectRepository(FeatureFlagOverride)
    private readonly overridesRepository: Repository<FeatureFlagOverride>,
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
  ) {}

  async findAll(): Promise<FeatureFlagListResponse> {
    try {
      const flags = await this.flagsRepository.find({ order: { key: 'ASC' } });
      return { flags: flags.map((flag) => this.toResponse(flag)) };
    } catch (error) {
      throw this.wrap('findAll', error);
    }
  }

  async create(dto: CreateFeatureFlagDto): Promise<FeatureFlagResponse> {
    try {
      const flag = this.flagsRepository.create({
        key: dto.key,
        title: dto.title,
        enabled: false,
      });
      const saved = await this.flagsRepository.save(flag);
      return this.toResponse(saved);
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException('Флаг с таким ключом уже существует');
      }
      throw this.wrap('create', error);
    }
  }

  async update(
    id: string,
    dto: UpdateFeatureFlagDto,
  ): Promise<FeatureFlagResponse> {
    try {
      const flag = await this.flagsRepository.findOne({ where: { id } });
      if (!flag) {
        throw new NotFoundException('Флаг не найден');
      }

      if (dto.key !== undefined) {
        flag.key = dto.key;
      }
      if (dto.title !== undefined) {
        flag.title = dto.title;
      }
      if (dto.enabled !== undefined) {
        flag.enabled = dto.enabled;
      }

      const saved = await this.flagsRepository.save(flag);
      return this.toResponse(saved);
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException('Флаг с таким ключом уже существует');
      }
      throw this.wrap('update', error);
    }
  }

  async remove(id: string): Promise<void> {
    try {
      const flag = await this.flagsRepository.findOne({ where: { id } });
      if (!flag) {
        throw new NotFoundException('Флаг не найден');
      }

      await this.flagsRepository.delete(id);
    } catch (error) {
      throw this.wrap('remove', error);
    }
  }

  async setOverride(
    flagId: string,
    userId: string,
    value: FeatureFlagOverrideValue,
  ): Promise<void> {
    try {
      if (!(await this.flagsRepository.exists({ where: { id: flagId } }))) {
        throw new NotFoundException('Флаг не найден');
      }
      if (!(await this.usersRepository.exists({ where: { id: userId } }))) {
        throw new NotFoundException('Пользователь не найден');
      }

      await this.overridesRepository.upsert(
        { flagId, userId, value },
        { conflictPaths: ['flagId', 'userId'] },
      );
    } catch (error) {
      throw this.wrap('setOverride', error);
    }
  }

  async deleteOverride(flagId: string, userId: string): Promise<void> {
    try {
      if (!(await this.flagsRepository.exists({ where: { id: flagId } }))) {
        throw new NotFoundException('Флаг не найден');
      }
      if (!(await this.usersRepository.exists({ where: { id: userId } }))) {
        throw new NotFoundException('Пользователь не найден');
      }

      await this.overridesRepository.delete({ flagId, userId });
    } catch (error) {
      throw this.wrap('deleteOverride', error);
    }
  }

  async findOverrides(
    flagId: string,
  ): Promise<FeatureFlagOverrideListResponse> {
    try {
      if (!(await this.flagsRepository.exists({ where: { id: flagId } }))) {
        throw new NotFoundException('Флаг не найден');
      }

      const overrides = await this.overridesRepository.find({
        where: { flagId },
        order: { createdAt: 'ASC', userId: 'ASC' },
      });

      return {
        overrides: overrides.map((override) =>
          this.toOverrideResponse(override),
        ),
      };
    } catch (error) {
      throw this.wrap('findOverrides', error);
    }
  }

  async getEffectiveForUser(
    userId: string | undefined,
  ): Promise<EffectiveFeatureFlagListResponse> {
    try {
      const flags = await this.flagsRepository.find({ order: { key: 'ASC' } });

      // Anonymous caller: no overrides to apply, so return global states as-is.
      if (userId === undefined) {
        return {
          flags: flags.map((flag) => ({
            key: flag.key,
            enabled: flag.enabled,
          })),
        };
      }

      const overrides = await this.overridesRepository.find({
        where: { userId },
      });
      const overrideByFlagId = new Map(
        overrides.map((override) => [override.flagId, override.value]),
      );

      return {
        flags: flags.map((flag) => {
          const override = overrideByFlagId.get(flag.id);
          const enabled =
            override === 'grant' || (flag.enabled && override !== 'deny');
          return { key: flag.key, enabled };
        }),
      };
    } catch (error) {
      throw this.wrap('getEffectiveForUser', error);
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

  private wrap(operation: string, error: unknown): HttpException {
    if (error instanceof HttpException) {
      return error;
    }
    const message = error instanceof Error ? error.message : String(error);
    return new HttpException(
      `from:${operation} ${message}`,
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }

  private toResponse(flag: FeatureFlag): FeatureFlagResponse {
    return {
      id: flag.id,
      key: flag.key,
      title: flag.title,
      enabled: flag.enabled,
      createdAt: flag.createdAt.toISOString(),
      updatedAt: flag.updatedAt.toISOString(),
    };
  }

  private toOverrideResponse(
    override: FeatureFlagOverride,
  ): FeatureFlagOverrideResponse {
    return {
      flagId: override.flagId,
      userId: override.userId,
      value: override.value,
      createdAt: override.createdAt.toISOString(),
    };
  }
}

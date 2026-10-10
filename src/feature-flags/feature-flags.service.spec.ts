import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { FeatureFlagsService } from './feature-flags.service';
import { FeatureFlag } from './entities/feature-flag.entity';
import {
  FeatureFlagOverride,
  FeatureFlagOverrideValue,
} from './entities/feature-flag-override.entity';
import { User } from '../users/entities/user.entity';

const createdAt = new Date('2026-01-01T00:00:00.000Z');

const mockFlag: FeatureFlag = {
  id: 'flag-1',
  key: 'read',
  title: 'Читать',
  enabled: true,
  createdAt,
  updatedAt: createdAt,
};

describe('FeatureFlagsService', () => {
  let service: FeatureFlagsService;
  let flagsRepository: {
    find: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    delete: jest.Mock;
    exists: jest.Mock;
  };
  let overridesRepository: {
    find: jest.Mock;
    upsert: jest.Mock;
    delete: jest.Mock;
  };
  let usersRepository: {
    exists: jest.Mock;
    findOne: jest.Mock;
  };

  beforeEach(async () => {
    flagsRepository = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      delete: jest.fn(),
      exists: jest.fn(),
    };
    overridesRepository = {
      find: jest.fn(),
      upsert: jest.fn(),
      delete: jest.fn(),
    };
    usersRepository = {
      exists: jest.fn(),
      findOne: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FeatureFlagsService,
        {
          provide: getRepositoryToken(FeatureFlag),
          useValue: flagsRepository,
        },
        {
          provide: getRepositoryToken(FeatureFlagOverride),
          useValue: overridesRepository,
        },
        {
          provide: getRepositoryToken(User),
          useValue: usersRepository,
        },
      ],
    }).compile();

    service = module.get<FeatureFlagsService>(FeatureFlagsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('returns flags mapped to the response shape with ISO timestamps', async () => {
      flagsRepository.find.mockResolvedValue([mockFlag]);

      const result = await service.findAll();

      expect(flagsRepository.find).toHaveBeenCalledWith({
        order: { key: 'ASC' },
      });
      expect(result.flags).toEqual([
        {
          id: 'flag-1',
          key: 'read',
          title: 'Читать',
          enabled: true,
          createdAt: createdAt.toISOString(),
          updatedAt: createdAt.toISOString(),
        },
      ]);
    });
  });

  describe('getEffectiveForUser', () => {
    const override = (
      value: FeatureFlagOverrideValue,
    ): FeatureFlagOverride => ({
      id: 'override-1',
      flagId: mockFlag.id,
      userId: 'user-1',
      value,
      createdAt,
    });

    const effectiveFor = (
      enabled: boolean,
      overrideValue?: FeatureFlagOverrideValue,
    ) => {
      flagsRepository.find.mockResolvedValue([{ ...mockFlag, enabled }]);
      overridesRepository.find.mockResolvedValue(
        overrideValue === undefined ? [] : [override(overrideValue)],
      );
      return service.getEffectiveForUser('user-1');
    };

    it('enables an enabled flag with no override', async () => {
      const result = await effectiveFor(true);
      expect(result.flags).toEqual([{ key: 'read', enabled: true }]);
    });

    it('disables an enabled flag with a deny override', async () => {
      const result = await effectiveFor(true, 'deny');
      expect(result.flags).toEqual([{ key: 'read', enabled: false }]);
    });

    it('enables a disabled flag with a grant override', async () => {
      const result = await effectiveFor(false, 'grant');
      expect(result.flags).toEqual([{ key: 'read', enabled: true }]);
    });

    // Uniform rule for every role (admin/moderator included): there is no
    // privileged bypass anymore, so a globally disabled flag without a grant
    // stays disabled for any authenticated user.
    it('keeps a globally disabled flag disabled without a grant for any role', async () => {
      const result = await effectiveFor(false);
      expect(result.flags).toEqual([{ key: 'read', enabled: false }]);
    });

    it('returns global states only for an anonymous caller and never reads overrides', async () => {
      flagsRepository.find.mockResolvedValue([
        { ...mockFlag, id: 'flag-1', key: 'read', enabled: true },
        { ...mockFlag, id: 'flag-2', key: 'study', enabled: false },
      ]);

      const result = await service.getEffectiveForUser(undefined);

      expect(result.flags).toEqual([
        { key: 'read', enabled: true },
        { key: 'study', enabled: false },
      ]);
      expect(overridesRepository.find).not.toHaveBeenCalled();
    });
  });

  describe('create', () => {
    it('creates a flag disabled by default', async () => {
      flagsRepository.create.mockImplementation((data) => data);
      flagsRepository.save.mockResolvedValue(mockFlag);

      await service.create({ key: 'read', title: 'Читать' });

      expect(flagsRepository.create).toHaveBeenCalledWith({
        key: 'read',
        title: 'Читать',
        enabled: false,
      });
      expect(flagsRepository.save).toHaveBeenCalled();
    });

    it('rejects with ConflictException on a duplicate key', async () => {
      flagsRepository.create.mockImplementation((data) => data);
      flagsRepository.save.mockRejectedValue({ code: '23505' });

      await expect(
        service.create({ key: 'read', title: 'Читать' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('update', () => {
    it('mutates only provided fields', async () => {
      flagsRepository.findOne.mockResolvedValue({ ...mockFlag });
      flagsRepository.save.mockImplementation((flag) => flag);

      const result = await service.update('flag-1', { enabled: false });

      expect(flagsRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ enabled: false, key: 'read' }),
      );
      expect(result.enabled).toBe(false);
    });

    it('rejects with NotFoundException when the flag is missing', async () => {
      flagsRepository.findOne.mockResolvedValue(null);

      await expect(
        service.update('missing', { enabled: true }),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects with ConflictException on a duplicate key', async () => {
      flagsRepository.findOne.mockResolvedValue({ ...mockFlag });
      flagsRepository.save.mockRejectedValue({ code: '23505' });

      await expect(service.update('flag-1', { key: 'study' })).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('remove', () => {
    it('deletes the flag; its overrides go with it via ON DELETE CASCADE', async () => {
      flagsRepository.findOne.mockResolvedValue({ ...mockFlag });

      await service.remove('flag-1');

      expect(flagsRepository.delete).toHaveBeenCalledWith('flag-1');
      expect(overridesRepository.delete).not.toHaveBeenCalled();
    });

    it('rejects with NotFoundException when the flag is missing', async () => {
      flagsRepository.findOne.mockResolvedValue(null);

      await expect(service.remove('missing')).rejects.toThrow(
        NotFoundException,
      );
      expect(flagsRepository.delete).not.toHaveBeenCalled();
    });
  });

  describe('setOverride', () => {
    it('upserts the override keyed on the (flag, user) pair', async () => {
      flagsRepository.exists.mockResolvedValue(true);
      usersRepository.exists.mockResolvedValue(true);

      await service.setOverride('flag-1', 'user-1', 'grant');

      expect(overridesRepository.upsert).toHaveBeenCalledWith(
        { flagId: 'flag-1', userId: 'user-1', value: 'grant' },
        { conflictPaths: ['flagId', 'userId'] },
      );
    });

    it('rejects with NotFoundException when the flag is missing', async () => {
      flagsRepository.exists.mockResolvedValue(false);

      await expect(
        service.setOverride('missing', 'user-1', 'grant'),
      ).rejects.toThrow(NotFoundException);
      expect(usersRepository.exists).not.toHaveBeenCalled();
    });

    it('rejects with NotFoundException when the user is missing', async () => {
      flagsRepository.exists.mockResolvedValue(true);
      usersRepository.exists.mockResolvedValue(false);

      await expect(
        service.setOverride('flag-1', 'missing', 'grant'),
      ).rejects.toThrow(NotFoundException);
      expect(overridesRepository.upsert).not.toHaveBeenCalled();
    });
  });

  describe('deleteOverride', () => {
    it('deletes the override for the flag/user pair', async () => {
      flagsRepository.exists.mockResolvedValue(true);
      usersRepository.exists.mockResolvedValue(true);

      await service.deleteOverride('flag-1', 'user-1');

      expect(overridesRepository.delete).toHaveBeenCalledWith({
        flagId: 'flag-1',
        userId: 'user-1',
      });
    });

    it('rejects with NotFoundException when the flag is missing', async () => {
      flagsRepository.exists.mockResolvedValue(false);

      await expect(service.deleteOverride('missing', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
      expect(overridesRepository.delete).not.toHaveBeenCalled();
    });

    it('rejects with NotFoundException when the user is missing', async () => {
      flagsRepository.exists.mockResolvedValue(true);
      usersRepository.exists.mockResolvedValue(false);

      await expect(service.deleteOverride('flag-1', 'missing')).rejects.toThrow(
        NotFoundException,
      );
      expect(overridesRepository.delete).not.toHaveBeenCalled();
    });
  });

  describe('findOverrides', () => {
    const overrideRow = (
      userId: string,
      timestamp: Date,
    ): FeatureFlagOverride => ({
      id: `override-${userId}`,
      flagId: mockFlag.id,
      userId,
      value: 'grant',
      createdAt: timestamp,
    });

    it('returns overrides mapped to the response shape in deterministic order', async () => {
      flagsRepository.exists.mockResolvedValue(true);
      const earlier = new Date('2026-01-01T00:00:00.000Z');
      const later = new Date('2026-02-01T00:00:00.000Z');
      overridesRepository.find.mockResolvedValue([
        overrideRow('user-1', earlier),
        overrideRow('user-2', later),
      ]);

      const result = await service.findOverrides('flag-1');

      expect(overridesRepository.find).toHaveBeenCalledWith({
        where: { flagId: 'flag-1' },
        order: { createdAt: 'ASC', userId: 'ASC' },
      });
      expect(result.overrides).toEqual([
        {
          flagId: 'flag-1',
          userId: 'user-1',
          value: 'grant',
          createdAt: earlier.toISOString(),
        },
        {
          flagId: 'flag-1',
          userId: 'user-2',
          value: 'grant',
          createdAt: later.toISOString(),
        },
      ]);
    });

    it('returns an empty list when the flag has no overrides', async () => {
      flagsRepository.exists.mockResolvedValue(true);
      overridesRepository.find.mockResolvedValue([]);

      const result = await service.findOverrides('flag-1');

      expect(result.overrides).toEqual([]);
    });

    it('rejects with NotFoundException when the flag is missing', async () => {
      flagsRepository.exists.mockResolvedValue(false);

      await expect(service.findOverrides('missing')).rejects.toThrow(
        NotFoundException,
      );
      expect(overridesRepository.find).not.toHaveBeenCalled();
    });
  });
});

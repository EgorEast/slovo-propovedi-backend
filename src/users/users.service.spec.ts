import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { UsersService } from './users.service';
import { User } from './entities/user.entity';
import { UserRole } from './user-role.enum';

jest.mock('bcrypt', () => ({
  hash: jest.fn().mockResolvedValue('hashed-password'),
}));

const mockUser: User = {
  id: 'user-1',
  name: 'Test User',
  email: 'test@example.com',
  username: 'testuser',
  password: 'hashed-password',
  role: UserRole.User,
};

const mockAdmin: User = {
  ...mockUser,
  id: 'admin-1',
  role: UserRole.Admin,
};

describe('UsersService', () => {
  let service: UsersService;
  let repository: {
    find: jest.Mock;
    findAndCount: jest.Mock;
    findOne: jest.Mock;
    save: jest.Mock;
    delete: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    count: jest.Mock;
  };
  let dataSource: {
    transaction: jest.Mock;
  };
  let transactionManager: {
    findOne: jest.Mock;
    save: jest.Mock;
    count: jest.Mock;
    delete: jest.Mock;
  };

  beforeEach(async () => {
    transactionManager = {
      findOne: jest.fn(),
      save: jest.fn(),
      count: jest.fn(),
      delete: jest.fn(),
    };

    dataSource = {
      // Real signature: dataSource.transaction('SERIALIZABLE', callback).
      transaction: jest.fn(async (isolation, callback) =>
        callback(transactionManager),
      ),
    };

    repository = {
      find: jest.fn(),
      findAndCount: jest.fn(),
      findOne: jest.fn(),
      save: jest.fn(),
      delete: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        {
          provide: getRepositoryToken(User),
          useValue: repository,
        },
        {
          provide: getDataSourceToken(),
          useValue: dataSource,
        },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('returns users without password wrapped with the total count', async () => {
      repository.findAndCount.mockResolvedValue([
        [mockUser, { ...mockUser, id: 'user-2' }],
        2,
      ]);

      const result = await service.findAll();

      expect(repository.findAndCount).toHaveBeenCalledWith({
        order: { id: 'DESC' },
      });
      expect(result.users).toHaveLength(2);
      expect(result.count).toBe(2);
      expect(result.users[0]).toEqual({
        id: mockUser.id,
        name: mockUser.name,
        username: mockUser.username,
        email: mockUser.email,
        role: UserRole.User,
      });
      expect(result.users[0]).not.toHaveProperty('password');
    });

    it('applies skip/take when page/limit are supplied', async () => {
      repository.findAndCount.mockResolvedValue([[mockUser], 5]);

      const result = await service.findAll(2, 10);

      expect(repository.findAndCount).toHaveBeenCalledWith({
        order: { id: 'DESC' },
        skip: 10,
        take: 10,
      });
      expect(result.users).toHaveLength(1);
      expect(result.count).toBe(5);
    });

    it('uses page 1 when only limit is supplied', async () => {
      repository.findAndCount.mockResolvedValue([[], 0]);

      await service.findAll(undefined, 20);

      expect(repository.findAndCount).toHaveBeenCalledWith({
        order: { id: 'DESC' },
        skip: 0,
        take: 20,
      });
    });
  });

  describe('findOne', () => {
    it('returns mapped user when found', async () => {
      repository.findOne.mockResolvedValue(mockUser);

      const result = await service.findOne('user-1');

      expect(result).toEqual({
        id: mockUser.id,
        name: mockUser.name,
        username: mockUser.username,
        email: mockUser.email,
        role: UserRole.User,
      });
      expect(result).not.toHaveProperty('password');
    });

    it('rejects with NotFoundException when user is not found', async () => {
      repository.findOne.mockResolvedValue(null);

      await expect(service.findOne('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('create', () => {
    const createDto = {
      name: 'Test User',
      email: 'test@example.com',
      username: 'testuser',
      password: 'plain-password',
    };

    it('hashes password, defaults role to user and returns user without password', async () => {
      repository.create.mockImplementation((data) => data);
      repository.save.mockResolvedValue(mockUser);

      const result = await service.create(createDto);

      expect(bcrypt.hash).toHaveBeenCalledWith('plain-password', 10);
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          password: 'hashed-password',
          role: UserRole.User,
        }),
      );
      expect(repository.save).toHaveBeenCalled();
      expect(result).toEqual({
        id: mockUser.id,
        name: mockUser.name,
        username: mockUser.username,
        email: mockUser.email,
        role: UserRole.User,
      });
      expect(result).not.toHaveProperty('password');
    });

    it('persists an explicitly provided role', async () => {
      repository.create.mockImplementation((data) => data);
      repository.save.mockResolvedValue({
        ...mockUser,
        role: UserRole.Moderator,
      });

      await service.create({ ...createDto, role: UserRole.Moderator });

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ role: UserRole.Moderator }),
      );
    });

    it('rejects with ConflictException on unique constraint violation', async () => {
      repository.create.mockImplementation((data) => data);
      repository.save.mockRejectedValue({ code: '23505' });

      await expect(service.create(createDto)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('update', () => {
    it('mutates only provided fields and returns mapped user', async () => {
      transactionManager.findOne.mockResolvedValue({ ...mockUser });
      transactionManager.save.mockImplementation((user) => user);

      const result = await service.update(
        'user-1',
        { name: 'Renamed' },
        'other-user',
      );

      expect(dataSource.transaction).toHaveBeenCalledWith(
        'SERIALIZABLE',
        expect.any(Function),
      );
      expect(transactionManager.save).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Renamed',
          email: mockUser.email,
          role: UserRole.User,
        }),
      );
      expect(result).toEqual({
        id: mockUser.id,
        name: 'Renamed',
        username: mockUser.username,
        email: mockUser.email,
        role: UserRole.User,
      });
    });

    it('updates the role when the target is not an admin', async () => {
      transactionManager.findOne.mockResolvedValue({ ...mockUser });
      transactionManager.save.mockImplementation((user) => user);

      const result = await service.update(
        'user-1',
        { role: UserRole.Moderator },
        'other-user',
      );

      expect(transactionManager.count).not.toHaveBeenCalled();
      expect(transactionManager.save).toHaveBeenCalledWith(
        expect.objectContaining({ role: UserRole.Moderator }),
      );
      expect(result.role).toBe(UserRole.Moderator);
    });

    it('rejects with NotFoundException when user is not found', async () => {
      transactionManager.findOne.mockResolvedValue(null);

      await expect(
        service.update('missing', { name: 'Renamed' }, 'other-user'),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects with ConflictException on unique constraint violation', async () => {
      transactionManager.findOne.mockResolvedValue({ ...mockUser });
      transactionManager.save.mockRejectedValue({ code: '23505' });

      await expect(
        service.update('user-1', { name: 'Renamed' }, 'other-user'),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects with ForbiddenException when changing own role', async () => {
      await expect(
        service.update('user-1', { role: UserRole.Moderator }, 'user-1'),
      ).rejects.toThrow(ForbiddenException);

      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('rejects with ForbiddenException when demoting the last admin', async () => {
      transactionManager.findOne.mockResolvedValue({ ...mockAdmin });
      transactionManager.count.mockResolvedValue(1);

      await expect(
        service.update('admin-1', { role: UserRole.User }, 'other-user'),
      ).rejects.toThrow(ForbiddenException);

      expect(transactionManager.count).toHaveBeenCalled();
      expect(transactionManager.save).not.toHaveBeenCalled();
    });

    it('allows demoting an admin when more than one admin remains', async () => {
      transactionManager.findOne.mockResolvedValue({ ...mockAdmin });
      transactionManager.count.mockResolvedValue(2);
      transactionManager.save.mockImplementation((user) => user);

      const result = await service.update(
        'admin-1',
        { role: UserRole.Moderator },
        'other-user',
      );

      expect(transactionManager.save).toHaveBeenCalledWith(
        expect.objectContaining({ role: UserRole.Moderator }),
      );
      expect(result.role).toBe(UserRole.Moderator);
    });
  });

  describe('changePassword', () => {
    it('hashes password and calls updatePassword with hashed value', async () => {
      repository.findOne.mockResolvedValue(mockUser);
      const updatePasswordSpy = jest
        .spyOn(service, 'updatePassword')
        .mockResolvedValue(undefined);

      await service.changePassword('user-1', { password: 'new-password' });

      expect(bcrypt.hash).toHaveBeenCalledWith('new-password', 10);
      expect(updatePasswordSpy).toHaveBeenCalledWith(
        'user-1',
        'hashed-password',
      );
    });

    it('rejects with NotFoundException when user is not found', async () => {
      repository.findOne.mockResolvedValue(null);

      await expect(
        service.changePassword('missing', { password: 'new-password' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('deletes a non-admin user without checking the admin count', async () => {
      transactionManager.findOne.mockResolvedValue({ ...mockUser });
      transactionManager.delete.mockResolvedValue({ affected: 1 });

      await service.remove('user-1', 'other-user');

      expect(dataSource.transaction).toHaveBeenCalledWith(
        'SERIALIZABLE',
        expect.any(Function),
      );
      expect(transactionManager.count).not.toHaveBeenCalled();
      expect(transactionManager.delete).toHaveBeenCalledWith(User, 'user-1');
    });

    it('deletes an admin when more than one admin remains', async () => {
      transactionManager.findOne.mockResolvedValue({ ...mockAdmin });
      transactionManager.count.mockResolvedValue(2);
      transactionManager.delete.mockResolvedValue({ affected: 1 });

      await service.remove('admin-1', 'other-user');

      expect(transactionManager.count).toHaveBeenCalled();
      expect(transactionManager.delete).toHaveBeenCalledWith(User, 'admin-1');
    });

    it('rejects with NotFoundException when user is not found', async () => {
      transactionManager.findOne.mockResolvedValue(null);

      await expect(service.remove('missing', 'other-user')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('rejects with ForbiddenException when deleting self', async () => {
      await expect(service.remove('user-1', 'user-1')).rejects.toThrow(
        ForbiddenException,
      );

      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('rejects with ForbiddenException when deleting the last admin', async () => {
      transactionManager.findOne.mockResolvedValue({ ...mockAdmin });
      transactionManager.count.mockResolvedValue(1);

      await expect(service.remove('admin-1', 'other-user')).rejects.toThrow(
        ForbiddenException,
      );

      expect(transactionManager.delete).not.toHaveBeenCalled();
    });
  });
});

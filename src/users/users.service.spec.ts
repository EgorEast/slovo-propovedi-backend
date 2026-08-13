import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { UsersService } from './users.service';
import { User } from './entities/user.entity';

jest.mock('bcrypt', () => ({
  hash: jest.fn().mockResolvedValue('hashed-password'),
}));

const mockUser: User = {
  id: 'user-1',
  name: 'Test User',
  email: 'test@example.com',
  username: 'testuser',
  password: 'hashed-password',
};

describe('UsersService', () => {
  let service: UsersService;
  let repository: {
    find: jest.Mock;
    findOne: jest.Mock;
    save: jest.Mock;
    delete: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    count: jest.Mock;
  };

  beforeEach(async () => {
    repository = {
      find: jest.fn(),
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
    it('returns users without password', async () => {
      repository.find.mockResolvedValue([
        mockUser,
        { ...mockUser, id: 'user-2' },
      ]);

      const result = await service.findAll();

      expect(repository.find).toHaveBeenCalled();
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        id: mockUser.id,
        name: mockUser.name,
        username: mockUser.username,
        email: mockUser.email,
      });
      expect(result[0]).not.toHaveProperty('password');
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

    it('hashes password, saves and returns user without password', async () => {
      repository.create.mockImplementation((data) => data);
      repository.save.mockResolvedValue(mockUser);

      const result = await service.create(createDto);

      expect(bcrypt.hash).toHaveBeenCalledWith('plain-password', 10);
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ password: 'hashed-password' }),
      );
      expect(repository.save).toHaveBeenCalled();
      expect(result).toEqual({
        id: mockUser.id,
        name: mockUser.name,
        username: mockUser.username,
        email: mockUser.email,
      });
      expect(result).not.toHaveProperty('password');
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
      repository.findOne.mockResolvedValue({ ...mockUser });
      repository.save.mockImplementation((user) => user);

      const result = await service.update('user-1', { name: 'Renamed' });

      expect(repository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Renamed',
          email: mockUser.email,
        }),
      );
      expect(result).toEqual({
        id: mockUser.id,
        name: 'Renamed',
        username: mockUser.username,
        email: mockUser.email,
      });
    });

    it('rejects with NotFoundException when user is not found', async () => {
      repository.findOne.mockResolvedValue(null);

      await expect(
        service.update('missing', { name: 'Renamed' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects with ConflictException on unique constraint violation', async () => {
      repository.findOne.mockResolvedValue({ ...mockUser });
      repository.save.mockRejectedValue({ code: '23505' });

      await expect(
        service.update('user-1', { name: 'Renamed' }),
      ).rejects.toThrow(ConflictException);
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
    it('deletes the user when it exists and is not the last admin', async () => {
      repository.findOne.mockResolvedValue(mockUser);
      repository.count.mockResolvedValue(3);
      repository.delete.mockResolvedValue({ affected: 1 });

      await service.remove('user-1', 'other-user');

      expect(repository.count).toHaveBeenCalled();
      expect(repository.delete).toHaveBeenCalledWith('user-1');
    });

    it('rejects with NotFoundException when user is not found', async () => {
      repository.findOne.mockResolvedValue(null);

      await expect(service.remove('missing', 'other-user')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('rejects with ForbiddenException when deleting self', async () => {
      await expect(service.remove('user-1', 'user-1')).rejects.toThrow(
        ForbiddenException,
      );

      expect(repository.findOne).not.toHaveBeenCalled();
      expect(repository.count).not.toHaveBeenCalled();
      expect(repository.delete).not.toHaveBeenCalled();
    });

    it('rejects with ForbiddenException when deleting the last admin', async () => {
      repository.findOne.mockResolvedValue(mockUser);
      repository.count.mockResolvedValue(1);

      await expect(service.remove('user-1', 'other-user')).rejects.toThrow(
        ForbiddenException,
      );

      expect(repository.delete).not.toHaveBeenCalled();
    });
  });
});

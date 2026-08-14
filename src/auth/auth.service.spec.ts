import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { JwtService } from '@nestjs/jwt';
import { UserRole } from '../users/user-role.enum';
import { getRepositoryToken } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { FindOperator } from 'typeorm';
import { RevokedRefreshToken } from './entities/revoked-refresh-token.entity';

jest.mock('bcrypt', () => ({
  compare: jest.fn().mockResolvedValue(true),
  hash: jest.fn().mockResolvedValue('hashed-password'),
}));

process.env.JWT_SECRET = 'test-jwt-secret';
process.env.JWT_REFRESH_SECRET = 'test-jwt-refresh-secret';

const sha256Hex = (value: string): string =>
  createHash('sha256').update(value).digest('hex');

const mockUser = {
  id: 'user-1',
  name: 'Test User',
  email: 'test@example.com',
  username: 'testuser',
  password: '$2a$10$abcdefghijklmnopqrstuv',
  role: UserRole.Admin,
};

describe('AuthService', () => {
  let service: AuthService;
  let usersService: {
    findOneByUsername: jest.Mock;
    findOneById: jest.Mock;
    updatePassword: jest.Mock;
  };
  let jwtService: {
    signAsync: jest.Mock;
    verifyAsync: jest.Mock;
  };
  let revokedTokensRepository: {
    findOne: jest.Mock;
    delete: jest.Mock;
    createQueryBuilder: jest.Mock;
  };

  function mockInsertQueryBuilder() {
    const queryBuilder = {
      insert: jest.fn(),
      into: jest.fn(),
      values: jest.fn(),
      orIgnore: jest.fn(),
      execute: jest.fn(),
    };
    queryBuilder.insert.mockReturnValue(queryBuilder);
    queryBuilder.into.mockReturnValue(queryBuilder);
    queryBuilder.values.mockReturnValue(queryBuilder);
    queryBuilder.orIgnore.mockReturnValue(queryBuilder);
    // Postgres RETURNING: one row when the insert landed, zero when a
    // concurrent logout/rotation already stored the hash (ON CONFLICT
    // DO NOTHING).
    queryBuilder.execute.mockResolvedValue({ raw: [{ id: 'inserted-row' }] });
    revokedTokensRepository.createQueryBuilder.mockReturnValue(queryBuilder);
    return queryBuilder;
  }

  beforeEach(async () => {
    revokedTokensRepository = {
      findOne: jest.fn().mockResolvedValue(null),
      delete: jest.fn().mockResolvedValue({ affected: 0 }),
      createQueryBuilder: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: UsersService,
          useValue: {
            findOneByUsername: jest.fn(),
            findOneById: jest.fn(),
            updatePassword: jest.fn(),
          },
        },
        {
          provide: JwtService,
          useValue: {
            signAsync: jest.fn(),
            verifyAsync: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(RevokedRefreshToken),
          useValue: revokedTokensRepository,
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    usersService = module.get(UsersService);
    jwtService = module.get(JwtService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('signIn', () => {
    it('signs tokens with a role-bearing payload and returns the user with role', async () => {
      usersService.findOneByUsername.mockResolvedValue(mockUser);
      jwtService.signAsync.mockResolvedValue('signed-token');

      const result = await service.signIn('testuser', 'password');

      expect(jwtService.signAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          id: mockUser.id,
          email: mockUser.email,
          role: UserRole.Admin,
        }),
        expect.anything(),
      );
      expect(result.user).toEqual({
        id: mockUser.id,
        name: mockUser.name,
        username: mockUser.username,
        email: mockUser.email,
        role: UserRole.Admin,
      });
    });

    it('rejects with UnauthorizedException when the user is unknown', async () => {
      usersService.findOneByUsername.mockResolvedValue(null);

      await expect(service.signIn('nobody', 'password')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('refreshTokens', () => {
    it('re-fetches the live user and re-signs with the fresh role', async () => {
      // Legacy refresh token payload — no role claim.
      jwtService.verifyAsync.mockResolvedValue({
        id: mockUser.id,
        email: mockUser.email,
        exp: Math.floor(Date.now() / 1000) + 60,
      });
      usersService.findOneById.mockResolvedValue({
        ...mockUser,
        role: UserRole.Moderator,
      });
      jwtService.signAsync.mockResolvedValue('signed-token');
      mockInsertQueryBuilder();

      const result = await service.refreshTokens('legacy-refresh-token');

      expect(usersService.findOneById).toHaveBeenCalledWith(mockUser.id);
      expect(jwtService.signAsync).toHaveBeenCalledWith(
        expect.objectContaining({ role: UserRole.Moderator }),
        expect.anything(),
      );
      expect(result).toEqual({
        accessToken: 'signed-token',
        refreshToken: 'signed-token',
      });
    });

    it('revokes the presented refresh token before issuing a fresh pair', async () => {
      const exp = Math.floor(Date.now() / 1000) + 60 * 60;
      jwtService.verifyAsync.mockResolvedValue({ id: mockUser.id, exp });
      usersService.findOneById.mockResolvedValue(mockUser);
      jwtService.signAsync.mockResolvedValue('signed-token');
      const queryBuilder = mockInsertQueryBuilder();

      const result = await service.refreshTokens('presented-refresh-token');

      // Rotation: the presented token hash lands in the denylist with the exp
      // from its own verified payload.
      expect(queryBuilder.values).toHaveBeenCalledWith({
        tokenHash: sha256Hex('presented-refresh-token'),
        userId: mockUser.id,
        expiresAt: new Date(exp * 1000),
      });
      expect(queryBuilder.orIgnore).toHaveBeenCalledTimes(1);
      expect(jwtService.signAsync).toHaveBeenCalledWith(
        expect.objectContaining({ id: mockUser.id, role: UserRole.Admin }),
        expect.anything(),
      );
      expect(result).toEqual({
        accessToken: 'signed-token',
        refreshToken: 'signed-token',
      });
    });

    it('propagates a revoke-store failure and issues no tokens', async () => {
      jwtService.verifyAsync.mockResolvedValue({
        id: mockUser.id,
        exp: Math.floor(Date.now() / 1000) + 60,
      });
      usersService.findOneById.mockResolvedValue(mockUser);
      const queryBuilder = mockInsertQueryBuilder();
      queryBuilder.execute.mockRejectedValue(new Error('database unavailable'));

      await expect(service.refreshTokens('token')).rejects.toThrow(
        'database unavailable',
      );

      expect(jwtService.signAsync).not.toHaveBeenCalled();
    });

    it('rejects when a concurrent rotation already stored the presented token', async () => {
      jwtService.verifyAsync.mockResolvedValue({
        id: mockUser.id,
        exp: Math.floor(Date.now() / 1000) + 60,
      });
      usersService.findOneById.mockResolvedValue(mockUser);
      const queryBuilder = mockInsertQueryBuilder();
      // ON CONFLICT DO NOTHING ignored the insert: the hash is already dead.
      queryBuilder.execute.mockResolvedValue({ raw: [] });

      await expect(service.refreshTokens('token')).rejects.toThrow(
        UnauthorizedException,
      );

      expect(jwtService.signAsync).not.toHaveBeenCalled();
    });

    it('rejects with UnauthorizedException when the refresh token is invalid', async () => {
      jwtService.verifyAsync.mockRejectedValue(new Error('expired'));

      await expect(service.refreshTokens('bad-refresh-token')).rejects.toThrow(
        UnauthorizedException,
      );

      expect(usersService.findOneById).not.toHaveBeenCalled();
    });

    it('rejects with UnauthorizedException when the user no longer exists', async () => {
      jwtService.verifyAsync.mockResolvedValue({ id: 'gone-user' });
      usersService.findOneById.mockResolvedValue(null);

      await expect(
        service.refreshTokens('orphan-refresh-token'),
      ).rejects.toThrow(UnauthorizedException);

      expect(jwtService.signAsync).not.toHaveBeenCalled();
    });

    it('rejects with UnauthorizedException when the token hash is on the denylist', async () => {
      jwtService.verifyAsync.mockResolvedValue({ id: mockUser.id });
      usersService.findOneById.mockResolvedValue(mockUser);
      revokedTokensRepository.findOne.mockResolvedValue({ id: 'revoked-row' });

      await expect(service.refreshTokens('revoked-token')).rejects.toThrow(
        UnauthorizedException,
      );

      expect(revokedTokensRepository.findOne).toHaveBeenCalledWith({
        where: { tokenHash: sha256Hex('revoked-token') },
        select: { id: true },
      });
      expect(jwtService.signAsync).not.toHaveBeenCalled();
    });
  });

  describe('logout', () => {
    it('stores the sha256 token hash, user id and exp, purging expired rows', async () => {
      const exp = Math.floor(Date.now() / 1000) + 60 * 60;
      jwtService.verifyAsync.mockResolvedValue({ id: mockUser.id, exp });
      usersService.findOneById.mockResolvedValue(mockUser);
      const queryBuilder = mockInsertQueryBuilder();

      await service.logout('refresh-token');

      expect(usersService.findOneById).toHaveBeenCalledWith(mockUser.id);
      expect(revokedTokensRepository.delete).toHaveBeenCalledWith({
        expiresAt: expect.any(FindOperator),
      });
      expect(revokedTokensRepository.createQueryBuilder).toHaveBeenCalledTimes(
        1,
      );
      expect(queryBuilder.values).toHaveBeenCalledWith({
        tokenHash: sha256Hex('refresh-token'),
        userId: mockUser.id,
        expiresAt: new Date(exp * 1000),
      });
      expect(queryBuilder.orIgnore).toHaveBeenCalledTimes(1);
    });

    it('is idempotent: a double logout of the same token still resolves', async () => {
      jwtService.verifyAsync.mockResolvedValue({
        id: mockUser.id,
        exp: Math.floor(Date.now() / 1000) + 60,
      });
      usersService.findOneById.mockResolvedValue(mockUser);
      const queryBuilder = mockInsertQueryBuilder();

      await service.logout('refresh-token');
      await service.logout('refresh-token');

      expect(queryBuilder.orIgnore).toHaveBeenCalledTimes(2);
      expect(queryBuilder.execute).toHaveBeenCalledTimes(2);
    });

    it('resolves without storing anything when the refresh token is invalid/expired', async () => {
      jwtService.verifyAsync.mockRejectedValue(new Error('expired'));

      await expect(service.logout('bad-token')).resolves.toBeUndefined();

      expect(usersService.findOneById).not.toHaveBeenCalled();
      expect(revokedTokensRepository.delete).not.toHaveBeenCalled();
      expect(revokedTokensRepository.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('keeps the 204 contract when the user no longer exists (nothing stored)', async () => {
      jwtService.verifyAsync.mockResolvedValue({
        id: 'deleted-user',
        exp: Math.floor(Date.now() / 1000) + 60,
      });
      usersService.findOneById.mockResolvedValue(null);

      await expect(service.logout('orphan-token')).resolves.toBeUndefined();

      expect(revokedTokensRepository.delete).not.toHaveBeenCalled();
      expect(revokedTokensRepository.createQueryBuilder).not.toHaveBeenCalled();
    });
  });

  describe('getProfile', () => {
    it('returns the live user profile including role', async () => {
      usersService.findOneById.mockResolvedValue(mockUser);

      const result = await service.getProfile(mockUser.id);

      expect(result).toEqual({
        id: mockUser.id,
        name: mockUser.name,
        username: mockUser.username,
        email: mockUser.email,
        role: UserRole.Admin,
      });
    });

    it('rejects with UnauthorizedException when the user is not found', async () => {
      usersService.findOneById.mockResolvedValue(null);

      await expect(service.getProfile('missing')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });
});

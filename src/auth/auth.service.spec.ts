import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { JwtService } from '@nestjs/jwt';
import { UserRole } from '../users/user-role.enum';

jest.mock('bcrypt', () => ({
  compare: jest.fn().mockResolvedValue(true),
  hash: jest.fn().mockResolvedValue('hashed-password'),
}));

process.env.JWT_SECRET = 'test-jwt-secret';
process.env.JWT_REFRESH_SECRET = 'test-jwt-refresh-secret';

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

  beforeEach(async () => {
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
      });
      usersService.findOneById.mockResolvedValue({
        ...mockUser,
        role: UserRole.Moderator,
      });
      jwtService.signAsync.mockResolvedValue('signed-token');

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

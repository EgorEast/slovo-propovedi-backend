import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { AuthGuard } from './guard/auth.guard';
import { UserRole } from '../users/user-role.enum';
import { getRepositoryToken } from '@nestjs/typeorm';
import { RevokedRefreshToken } from './entities/revoked-refresh-token.entity';

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

describe('AuthController', () => {
  let controller: AuthController;
  let authService: AuthService;
  let usersService: {
    findOneByUsername: jest.Mock;
    findOneById: jest.Mock;
    updatePassword: jest.Mock;
  };
  let jwtService: {
    signAsync: jest.Mock;
    verifyAsync: jest.Mock;
  };
  let module: TestingModule;

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
    // Postgres RETURNING: one row when the insert landed (rotation stores the
    // presented token hash before signing the fresh pair).
    queryBuilder.execute.mockResolvedValue({ raw: [{ id: 'inserted-row' }] });
    const repository = module.get(getRepositoryToken(RevokedRefreshToken));
    repository.createQueryBuilder.mockReturnValue(queryBuilder);
    return queryBuilder;
  }

  beforeEach(async () => {
    module = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        AuthService,
        AuthGuard,
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
          useValue: {
            findOne: jest.fn().mockResolvedValue(null),
            delete: jest.fn(),
            createQueryBuilder: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
    authService = module.get<AuthService>(AuthService);
    usersService = module.get(UsersService);
    jwtService = module.get(JwtService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('signIn returns a user with role', async () => {
    usersService.findOneByUsername.mockResolvedValue(mockUser);
    jwtService.signAsync.mockResolvedValue('signed-token');

    const result = await controller.signIn({
      username: 'testuser',
      password: 'password',
    } as never);

    expect(result.user.role).toBe(UserRole.Admin);
  });

  it('refresh delegates to the service and re-signs with the fresh role', async () => {
    jwtService.verifyAsync.mockResolvedValue({
      id: mockUser.id,
      exp: Math.floor(Date.now() / 1000) + 60,
    });
    usersService.findOneById.mockResolvedValue({
      ...mockUser,
      role: UserRole.Moderator,
    });
    jwtService.signAsync.mockResolvedValue('signed-token');
    mockInsertQueryBuilder();

    const result = await controller.refresh({
      refreshToken: 'refresh-token',
    } as never);

    expect(usersService.findOneById).toHaveBeenCalledWith(mockUser.id);
    expect(result.accessToken).toBe('signed-token');
  });

  it('logout delegates to the service with the refresh token', async () => {
    const logoutSpy = jest
      .spyOn(authService, 'logout')
      .mockResolvedValue(undefined);

    await controller.logout({ refreshToken: 'refresh-token' } as never);

    expect(logoutSpy).toHaveBeenCalledWith('refresh-token');
  });

  it('getProfile returns the live user profile including role', async () => {
    usersService.findOneById.mockResolvedValue(mockUser);

    const result = await controller.getProfile({
      user: { id: mockUser.id },
    } as never);

    expect(result.role).toBe(UserRole.Admin);
  });
});

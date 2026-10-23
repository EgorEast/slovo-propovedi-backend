import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthGuard } from './auth.guard';
import { UsersService } from '../../users/users.service';
import { UserRole } from '../../users/user-role.enum';

describe('AuthGuard', () => {
  let guard: AuthGuard;
  let jwtService: { verifyAsync: jest.Mock };
  let usersService: { findByIdForAuth: jest.Mock };
  const secret = 'test-secret-at-least-32-characters-long';
  const userId = '11111111-1111-4111-8111-111111111111';

  const buildContext = (headers: Record<string, string | undefined>) => {
    return {
      switchToHttp: () => ({ getRequest: () => ({ headers }) }),
    } as never;
  };

  beforeEach(() => {
    process.env.JWT_SECRET = secret;
    jwtService = { verifyAsync: jest.fn() };
    usersService = { findByIdForAuth: jest.fn() };
    usersService.findByIdForAuth.mockResolvedValue({
      id: userId,
      role: UserRole.Admin,
      tokenVersion: 0,
    });
    guard = new AuthGuard(
      jwtService as unknown as JwtService,
      usersService as unknown as UsersService,
    );
  });

  afterEach(() => {
    delete process.env.JWT_SECRET;
    jest.clearAllMocks();
  });

  it('throws UnauthorizedException when the Authorization header is missing', async () => {
    await expect(guard.canActivate(buildContext({}))).rejects.toThrow(
      UnauthorizedException,
    );
    expect(jwtService.verifyAsync).not.toHaveBeenCalled();
    expect(usersService.findByIdForAuth).not.toHaveBeenCalled();
  });

  it('throws UnauthorizedException when the token is not a Bearer token', async () => {
    await expect(
      guard.canActivate(buildContext({ authorization: 'Basic abc' })),
    ).rejects.toThrow(UnauthorizedException);
    expect(jwtService.verifyAsync).not.toHaveBeenCalled();
  });

  it('throws UnauthorizedException when the payload lacks a role (legacy token)', async () => {
    jwtService.verifyAsync.mockResolvedValue({
      id: userId,
      email: 'user@example.com',
    });

    await expect(
      guard.canActivate(buildContext({ authorization: 'Bearer legacy-token' })),
    ).rejects.toThrow(UnauthorizedException);

    expect(usersService.findByIdForAuth).not.toHaveBeenCalled();
  });

  it('parses a well-formed payload onto request.user with the live role', async () => {
    const payload = {
      id: userId,
      email: 'user@example.com',
      role: UserRole.Admin,
      tokenVersion: 2,
    };
    jwtService.verifyAsync.mockResolvedValue(payload);
    usersService.findByIdForAuth.mockResolvedValue({
      id: userId,
      role: UserRole.Moderator,
      tokenVersion: 2,
    });
    const request: {
      headers: Record<string, string | undefined>;
      user?: unknown;
    } = { headers: { authorization: 'Bearer valid-token' } };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as never;

    await expect(guard.canActivate(context)).resolves.toBe(true);

    // Role comes from the DB row, not the (possibly stale) token claim.
    expect(request.user).toEqual({ ...payload, role: UserRole.Moderator });
    expect(usersService.findByIdForAuth).toHaveBeenCalledWith(userId);
    // Algorithm is pinned: a token that claims another alg is rejected by
    // jsonwebtoken before the payload schema ever sees it.
    expect(jwtService.verifyAsync).toHaveBeenCalledWith('valid-token', {
      secret,
      algorithms: ['HS256'],
    });
  });

  it('treats a missing tokenVersion claim as version 0', async () => {
    jwtService.verifyAsync.mockResolvedValue({
      id: userId,
      email: 'user@example.com',
      role: UserRole.User,
    });
    usersService.findByIdForAuth.mockResolvedValue({
      id: userId,
      role: UserRole.User,
      tokenVersion: 0,
    });

    await expect(
      guard.canActivate(buildContext({ authorization: 'Bearer legacy-token' })),
    ).resolves.toBe(true);
  });

  it('rejects a token whose version does not match the live user', async () => {
    jwtService.verifyAsync.mockResolvedValue({
      id: userId,
      email: 'user@example.com',
      role: UserRole.Admin,
      tokenVersion: 1,
    });
    usersService.findByIdForAuth.mockResolvedValue({
      id: userId,
      role: UserRole.Admin,
      tokenVersion: 2,
    });

    await expect(
      guard.canActivate(buildContext({ authorization: 'Bearer stale-token' })),
    ).rejects.toThrow('Session has been revoked');
  });

  it('rejects a token whose user no longer exists', async () => {
    jwtService.verifyAsync.mockResolvedValue({
      id: userId,
      email: 'user@example.com',
      role: UserRole.User,
    });
    usersService.findByIdForAuth.mockResolvedValue(null);

    await expect(
      guard.canActivate(buildContext({ authorization: 'Bearer orphan-token' })),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException when verifyAsync rejects', async () => {
    jwtService.verifyAsync.mockRejectedValue(new Error('invalid token'));

    await expect(
      guard.canActivate(buildContext({ authorization: 'Bearer bad-token' })),
    ).rejects.toThrow(UnauthorizedException);
    expect(usersService.findByIdForAuth).not.toHaveBeenCalled();
  });

  it('fails loud when JWT_SECRET is not configured', async () => {
    delete process.env.JWT_SECRET;
    const rejection = guard.canActivate(
      buildContext({ authorization: 'Bearer valid-token' }),
    );

    await expect(rejection).rejects.toThrow(
      'JWT_SECRET environment variable is not set',
    );
    await expect(rejection).rejects.not.toBeInstanceOf(UnauthorizedException);
    expect(jwtService.verifyAsync).not.toHaveBeenCalled();
  });

  it('fails loud when JWT_SECRET is shorter than 32 characters', async () => {
    process.env.JWT_SECRET = 'too-short';
    const rejection = guard.canActivate(
      buildContext({ authorization: 'Bearer valid-token' }),
    );

    await expect(rejection).rejects.toThrow(
      /JWT_SECRET must be at least 32 characters/,
    );
    await expect(rejection).rejects.not.toBeInstanceOf(UnauthorizedException);
    expect(jwtService.verifyAsync).not.toHaveBeenCalled();
  });
});

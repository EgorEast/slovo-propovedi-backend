import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { OptionalAuthGuard } from './optional-auth.guard';
import { UsersService } from '../../users/users.service';
import { UserRole } from '../../users/user-role.enum';

describe('OptionalAuthGuard', () => {
  let guard: OptionalAuthGuard;
  let jwtService: { verifyAsync: jest.Mock };
  let usersService: { findByIdForAuth: jest.Mock };
  const secret = 'test-secret-at-least-32-characters-long';
  const userId = '11111111-1111-4111-8111-111111111111';

  const buildContext = (headers: Record<string, string | undefined>) => {
    const request: {
      headers: Record<string, string | undefined>;
      user?: unknown;
    } = { headers };
    return {
      context: {
        switchToHttp: () => ({ getRequest: () => request }),
      } as never,
      request,
    };
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
    guard = new OptionalAuthGuard(
      jwtService as unknown as JwtService,
      usersService as unknown as UsersService,
    );
  });

  afterEach(() => {
    delete process.env.JWT_SECRET;
    jest.clearAllMocks();
  });

  it('proceeds anonymously when the Authorization header is missing', async () => {
    const { context, request } = buildContext({});

    await expect(guard.canActivate(context)).resolves.toBe(true);

    expect(request.user).toBeUndefined();
    expect(jwtService.verifyAsync).not.toHaveBeenCalled();
    expect(usersService.findByIdForAuth).not.toHaveBeenCalled();
  });

  it('proceeds anonymously when the token is not a Bearer token', async () => {
    const { context, request } = buildContext({ authorization: 'Basic abc' });

    await expect(guard.canActivate(context)).resolves.toBe(true);

    expect(request.user).toBeUndefined();
    expect(jwtService.verifyAsync).not.toHaveBeenCalled();
  });

  it('attaches the parsed payload with the live role for a valid token', async () => {
    const payload = {
      id: userId,
      email: 'user@example.com',
      role: UserRole.Admin,
    };
    jwtService.verifyAsync.mockResolvedValue(payload);
    usersService.findByIdForAuth.mockResolvedValue({
      id: userId,
      role: UserRole.Moderator,
      tokenVersion: 0,
    });
    const { context, request } = buildContext({
      authorization: 'Bearer valid-token',
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);

    expect(jwtService.verifyAsync).toHaveBeenCalledWith('valid-token', {
      secret,
      algorithms: ['HS256'],
    });
    expect(request.user).toEqual({ ...payload, role: UserRole.Moderator });
  });

  it('rejects with 401 when the token version was revoked', async () => {
    jwtService.verifyAsync.mockResolvedValue({
      id: userId,
      email: 'user@example.com',
      role: UserRole.Admin,
      tokenVersion: 0,
    });
    usersService.findByIdForAuth.mockResolvedValue({
      id: userId,
      role: UserRole.Admin,
      tokenVersion: 1,
    });
    const { context, request } = buildContext({
      authorization: 'Bearer stale-token',
    });

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );

    expect(request.user).toBeUndefined();
  });

  it('rejects with 401 when the token fails verification (invalid/expired)', async () => {
    jwtService.verifyAsync.mockRejectedValue(new Error('invalid token'));
    const { context, request } = buildContext({
      authorization: 'Bearer bad-token',
    });

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );

    expect(request.user).toBeUndefined();
    expect(usersService.findByIdForAuth).not.toHaveBeenCalled();
  });

  it('rejects with 401 for a legacy token without a role claim', async () => {
    jwtService.verifyAsync.mockResolvedValue({
      id: userId,
      email: 'user@example.com',
    });
    const { context, request } = buildContext({
      authorization: 'Bearer legacy-token',
    });

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );

    expect(request.user).toBeUndefined();
    expect(usersService.findByIdForAuth).not.toHaveBeenCalled();
  });

  it('fails loud when JWT_SECRET is not configured', async () => {
    delete process.env.JWT_SECRET;
    const { context } = buildContext({ authorization: 'Bearer valid-token' });

    const result = guard.canActivate(context);

    await expect(result).rejects.toThrow(
      'JWT_SECRET environment variable is not set',
    );
    await expect(result).rejects.not.toBeInstanceOf(UnauthorizedException);
    expect(jwtService.verifyAsync).not.toHaveBeenCalled();
  });
});

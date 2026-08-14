import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthGuard } from './auth.guard';
import { UserRole } from '../../users/user-role.enum';

describe('AuthGuard', () => {
  let guard: AuthGuard;
  let jwtService: { verifyAsync: jest.Mock };
  const secret = 'test-secret';

  const buildContext = (headers: Record<string, string | undefined>) => {
    return {
      switchToHttp: () => ({ getRequest: () => ({ headers }) }),
    } as never;
  };

  beforeEach(() => {
    process.env.JWT_SECRET = secret;
    jwtService = { verifyAsync: jest.fn() };
    guard = new AuthGuard(jwtService as unknown as JwtService);
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
  });

  it('throws UnauthorizedException when the token is not a Bearer token', async () => {
    await expect(
      guard.canActivate(buildContext({ authorization: 'Basic abc' })),
    ).rejects.toThrow(UnauthorizedException);
    expect(jwtService.verifyAsync).not.toHaveBeenCalled();
  });

  it('throws UnauthorizedException when the payload lacks a role (legacy token)', async () => {
    jwtService.verifyAsync.mockResolvedValue({
      id: '11111111-1111-4111-8111-111111111111',
      email: 'user@example.com',
    });

    await expect(
      guard.canActivate(buildContext({ authorization: 'Bearer legacy-token' })),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('parses a well-formed payload onto request.user and allows the request', async () => {
    const payload = {
      id: '11111111-1111-4111-8111-111111111111',
      email: 'user@example.com',
      role: UserRole.Admin,
    };
    jwtService.verifyAsync.mockResolvedValue(payload);
    const request: {
      headers: Record<string, string | undefined>;
      user?: unknown;
    } = { headers: { authorization: 'Bearer valid-token' } };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as never;

    await expect(guard.canActivate(context)).resolves.toBe(true);

    expect(request.user).toEqual(payload);
  });

  it('throws UnauthorizedException when verifyAsync rejects', async () => {
    jwtService.verifyAsync.mockRejectedValue(new Error('invalid token'));

    await expect(
      guard.canActivate(buildContext({ authorization: 'Bearer bad-token' })),
    ).rejects.toThrow(UnauthorizedException);
  });
});

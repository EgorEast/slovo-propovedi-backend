import { JwtService } from '@nestjs/jwt';
import { OptionalAuthGuard } from './optional-auth.guard';
import { UserRole } from '../../users/user-role.enum';

describe('OptionalAuthGuard', () => {
  let guard: OptionalAuthGuard;
  let jwtService: { verifyAsync: jest.Mock };
  const secret = 'test-secret';

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
    guard = new OptionalAuthGuard(jwtService as unknown as JwtService);
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
  });

  it('proceeds anonymously when the token is not a Bearer token', async () => {
    const { context, request } = buildContext({ authorization: 'Basic abc' });

    await expect(guard.canActivate(context)).resolves.toBe(true);

    expect(request.user).toBeUndefined();
    expect(jwtService.verifyAsync).not.toHaveBeenCalled();
  });

  it('attaches the parsed payload for a valid token', async () => {
    const payload = {
      id: '11111111-1111-4111-8111-111111111111',
      email: 'user@example.com',
      role: UserRole.Admin,
    };
    jwtService.verifyAsync.mockResolvedValue(payload);
    const { context, request } = buildContext({
      authorization: 'Bearer valid-token',
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);

    expect(jwtService.verifyAsync).toHaveBeenCalledWith('valid-token', {
      secret,
    });
    expect(request.user).toEqual(payload);
  });

  it('proceeds anonymously when the token fails verification (invalid/expired)', async () => {
    jwtService.verifyAsync.mockRejectedValue(new Error('invalid token'));
    const { context, request } = buildContext({
      authorization: 'Bearer bad-token',
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);

    expect(request.user).toBeUndefined();
  });

  it('proceeds anonymously for a legacy token without a role claim', async () => {
    jwtService.verifyAsync.mockResolvedValue({
      id: '11111111-1111-4111-8111-111111111111',
      email: 'user@example.com',
    });
    const { context, request } = buildContext({
      authorization: 'Bearer legacy-token',
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);

    expect(request.user).toBeUndefined();
  });

  it('fails loud when JWT_SECRET is not configured', async () => {
    delete process.env.JWT_SECRET;
    const { context } = buildContext({ authorization: 'Bearer valid-token' });

    await expect(guard.canActivate(context)).rejects.toThrow(
      'JWT_SECRET environment variable is not set',
    );
    expect(jwtService.verifyAsync).not.toHaveBeenCalled();
  });
});

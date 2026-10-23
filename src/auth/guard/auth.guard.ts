import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { z } from 'zod';
import { UsersService } from '../../users/users.service';
import { UserRole } from '../../users/user-role.enum';

// The only trusted shape of a valid access token. Parsing at the boundary means
// the rest of the app can treat `request.user` as already-validated data —
// legacy tokens without a `role` claim fail here with 401, and the admin
// client's refresh-retry seamlessly upgrades them to role-bearing tokens.
// `tokenVersion` is optional for the same reason: tokens issued before session
// versioning are treated as version 0, the column's default.
export const accessTokenPayloadSchema = z.object({
  id: z.string().uuid(),
  email: z.string(),
  role: z.enum(UserRole),
  tokenVersion: z.number().int().nonnegative().optional(),
});

export type AccessTokenPayload = z.infer<typeof accessTokenPayloadSchema>;

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly usersService: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const token = this.extractTokenFromHeader(request);

    if (!token) {
      throw new UnauthorizedException();
    }

    // A missing secret is a server misconfiguration, not a bad token — resolve
    // it outside the try so it fails loud instead of turning into a 401.
    const secret = this.resolveSecret();
    const payload = await this.verifyOrThrow(token, secret);

    request['user'] = await this.resolveLiveUser(payload);

    return true;
  }

  protected resolveSecret(): string {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      throw new Error('JWT_SECRET environment variable is not set');
    }
    return secret;
  }

  // Any verification/parse failure is an authentication failure (401). The
  // caller's refresh-retry upgrades legacy tokens and recovers when possible.
  protected async verifyOrThrow(
    token: string,
    secret: string,
  ): Promise<AccessTokenPayload> {
    try {
      return await this.verifyToken(token, secret);
    } catch {
      throw new UnauthorizedException();
    }
  }

  protected async verifyToken(
    token: string,
    secret: string,
  ): Promise<AccessTokenPayload> {
    const payload = await this.jwtService.verifyAsync(token, { secret });
    return accessTokenPayloadSchema.parse(payload);
  }

  // The token is signed data, not live truth: a deleted account or a password
  // change must stop working immediately. Loading the row on every request is
  // the price of that guarantee; the guard takes the role from the live row so
  // a demoted user loses access without waiting for token expiry.
  protected async resolveLiveUser(
    payload: AccessTokenPayload,
  ): Promise<AccessTokenPayload> {
    const user = await this.usersService.findByIdForAuth(payload.id);

    if (!user) {
      throw new UnauthorizedException('User no longer exists');
    }

    if (user.tokenVersion !== (payload.tokenVersion ?? 0)) {
      // Distinct message so the client refresh-retry surface is explicit; the
      // refresh token carries the same stale version and is rejected too, so
      // the user must sign in again.
      throw new UnauthorizedException(
        'Session has been revoked. Please sign in again.',
      );
    }

    return { ...payload, role: user.role };
  }

  protected extractTokenFromHeader(request: Request): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}

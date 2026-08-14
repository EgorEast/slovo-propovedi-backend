import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { z } from 'zod';
import { UserRole } from '../../users/user-role.enum';

// The only trusted shape of a valid access token. Parsing at the boundary means
// the rest of the app can treat `request.user` as already-validated data —
// legacy tokens without a `role` claim fail here with 401, and the admin
// client's refresh-retry seamlessly upgrades them to role-bearing tokens.
export const accessTokenPayloadSchema = z.object({
  id: z.string().uuid(),
  email: z.string(),
  role: z.enum(UserRole),
});

export type AccessTokenPayload = z.infer<typeof accessTokenPayloadSchema>;

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const token = this.extractTokenFromHeader(request);

    if (!token) {
      throw new UnauthorizedException();
    }

    const secret = process.env.JWT_SECRET;
    if (!secret) {
      throw new Error('JWT_SECRET environment variable is not set');
    }

    try {
      const payload = await this.jwtService.verifyAsync(token, {
        secret,
      });
      request['user'] = accessTokenPayloadSchema.parse(payload);
    } catch {
      throw new UnauthorizedException();
    }

    return true;
  }

  private extractTokenFromHeader(request: Request): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}

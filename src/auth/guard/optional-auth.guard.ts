import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthGuard } from './auth.guard';

// Authentication is optional: a valid Bearer token attaches `{ id, role }` to
// `request.user`; a missing, invalid or expired token leaves it undefined and
// the request proceeds. This guard never answers 401.
@Injectable()
export class OptionalAuthGuard extends AuthGuard implements CanActivate {
  constructor(jwtService: JwtService) {
    super(jwtService);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const token = this.extractTokenFromHeader(request);

    if (!token) {
      return true;
    }

    // A missing secret is a server misconfiguration, not a bad token — resolve
    // it outside the try so it fails loud instead of silently downgrading the
    // caller to anonymous.
    const secret = this.resolveSecret();

    try {
      request['user'] = await this.verifyToken(token, secret);
    } catch {
      // Invalid, expired or legacy token → anonymous request.
    }

    return true;
  }
}

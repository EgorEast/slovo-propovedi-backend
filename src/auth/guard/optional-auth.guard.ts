import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../../users/users.service';
import { AuthGuard } from './auth.guard';

// Authentication is optional only for a missing token: the request proceeds
// anonymously and `request.user` stays undefined. A token that is present but
// fails verification — invalid, expired, revoked or legacy — answers 401
// instead of silently downgrading the caller to anonymous, so the client can
// refresh the token and retry. A valid Bearer token attaches `{ id, role }`
// to `request.user`, with the role read from the live user row.
@Injectable()
export class OptionalAuthGuard extends AuthGuard implements CanActivate {
  constructor(jwtService: JwtService, usersService: UsersService) {
    super(jwtService, usersService);
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
    const payload = await this.verifyOrThrow(token, secret);

    request['user'] = await this.resolveLiveUser(payload);

    return true;
  }
}

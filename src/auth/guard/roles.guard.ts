import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '../../users/user-role.enum';
import { ROLES_KEY } from '../decorators/roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    // No @Roles() decorator → this guard is not the deciding factor (an
    // authenticated-only route just pairs AuthGuard without RolesGuard).
    if (!requiredRoles) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest();

    // Fail-closed: a missing user/role must never pass the role check.
    if (!user?.role) {
      throw new ForbiddenException();
    }

    if (!requiredRoles.includes(user.role)) {
      throw new ForbiddenException();
    }

    return true;
  }
}

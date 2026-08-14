import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import { UserRole } from '../../users/user-role.enum';

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: { getAllAndOverride: jest.Mock };

  const buildContext = (user?: { id?: string; role?: UserRole }) => {
    return {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    } as never;
  };

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() };
    guard = new RolesGuard(reflector as unknown as Reflector);
  });

  it('allows the request when no @Roles() metadata is present', () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);

    expect(guard.canActivate(buildContext(undefined))).toBe(true);
  });

  it('throws ForbiddenException when the user is missing entirely', () => {
    reflector.getAllAndOverride.mockReturnValue([UserRole.Admin]);

    expect(() => guard.canActivate(buildContext(undefined))).toThrow(
      ForbiddenException,
    );
  });

  it('throws ForbiddenException when the user has no role', () => {
    reflector.getAllAndOverride.mockReturnValue([UserRole.Admin]);

    expect(() => guard.canActivate(buildContext({ id: 'user-1' }))).toThrow(
      ForbiddenException,
    );
  });

  it('allows the request when the user holds an allowed role', () => {
    reflector.getAllAndOverride.mockReturnValue([
      UserRole.Admin,
      UserRole.Moderator,
    ]);

    expect(
      guard.canActivate(
        buildContext({ id: 'user-1', role: UserRole.Moderator }),
      ),
    ).toBe(true);
  });

  it('throws ForbiddenException when the user holds a disallowed role', () => {
    reflector.getAllAndOverride.mockReturnValue([UserRole.Admin]);

    expect(() =>
      guard.canActivate(buildContext({ id: 'user-1', role: UserRole.User })),
    ).toThrow(ForbiddenException);
  });
});

import { type ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { CommunityController } from '../../../src/community';
import { IS_ROLES_ROUTE } from '../../../src/shared/decorators/roles.decorator';
import { RolesGuard } from '../../../src/shared/guards/roles.guard';

/**
 * Every authenticated user is allowlisted as owner or admin, so no live session
 * can produce a 403 on these routes. These assertions pin the guard and its
 * role list instead, so widening or dropping either is caught here.
 */
describe('CommunityController access control', () => {
  it('guards the whole controller with RolesGuard', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, CommunityController) ?? [];

    expect(guards).toContain(RolesGuard);
  });

  it('requires the owner or admin role for every route', () => {
    const reflector = new Reflector();
    const routes = [
      'list',
      'subscribeToEvents',
      'getDiscordInstallUrl',
      'handleDiscordCallback',
      'listResources',
      'checkHealth',
      'disconnect',
    ] as const;

    for (const route of routes) {
      const roles = reflector.getAllAndOverride(IS_ROLES_ROUTE, [
        CommunityController.prototype[route],
        CommunityController,
      ]);

      expect(roles, route).toEqual(['owner', 'admin']);
    }
  });

  it('answers 403 for a role outside that list and 401 with no session', () => {
    const guard = new RolesGuard(new Reflector());
    const context = (authContext?: object) =>
      ({
        getType: () => 'http',
        getHandler: () => CommunityController.prototype.list,
        getClass: () => CommunityController,
        switchToHttp: () => ({ getRequest: () => (authContext ? { authContext } : {}) }),
      }) as unknown as ExecutionContext;

    vi.spyOn(Reflector.prototype, 'getAllAndOverride').mockReturnValue(['owner', 'admin']);

    expect(() => guard.canActivate(context({ role: 'viewer' }))).toThrow(ForbiddenException);
    expect(() => guard.canActivate(context())).toThrow(UnauthorizedException);

    vi.restoreAllMocks();
  });
});

import { type ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RolesGuard } from '../../../src/shared/guards/roles.guard';

function createHttpContext(role?: 'admin' | 'owner'): {
  context: ExecutionContext;
  request: any;
} {
  const request = role ? { authContext: { role } } : {};

  const context = {
    getType: vi.fn().mockReturnValue('http'),
    getHandler: vi.fn().mockReturnValue(() => {}),
    getClass: vi.fn().mockReturnValue(class {}),
    switchToHttp: vi.fn().mockReturnValue({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;

  return { context, request };
}

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new RolesGuard(reflector);
  });

  it('allows routes without @Roles metadata', () => {
    const { context } = createHttpContext('admin');
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);

    expect(guard.canActivate(context)).toBe(true);
  });

  it('allows matching roles', () => {
    const { context } = createHttpContext('owner');
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['owner']);

    expect(guard.canActivate(context)).toBe(true);
  });

  it('throws ForbiddenException when the role does not match', () => {
    const { context } = createHttpContext('admin');
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['owner']);

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('throws UnauthorizedException when role metadata is present but auth context is missing', () => {
    const { context } = createHttpContext();
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['owner']);

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('allows non-HTTP contexts', () => {
    const context = {
      getType: vi.fn().mockReturnValue('rpc'),
    } as unknown as ExecutionContext;

    expect(guard.canActivate(context)).toBe(true);
  });
});

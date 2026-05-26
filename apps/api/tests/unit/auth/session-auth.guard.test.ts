import { type ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionAuthGuard } from '../../../src/shared/guards/session-auth.guard';

function createHttpContext(_overrides: { isPublic?: boolean } = {}): {
  context: ExecutionContext;
  request: any;
  response: any;
} {
  const request = { headers: {} } as any;
  const response = {} as any;

  const context = {
    getType: vi.fn().mockReturnValue('http'),
    getHandler: vi.fn().mockReturnValue(() => {}),
    getClass: vi.fn().mockReturnValue(class {}),
    switchToHttp: vi.fn().mockReturnValue({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ExecutionContext;

  return { context, request, response };
}

describe('SessionAuthGuard', () => {
  let guard: SessionAuthGuard;
  let reflector: Reflector;
  const authService = {
    requireSession: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    reflector = new Reflector();
    guard = new SessionAuthGuard(reflector, authService as never);
  });

  it('allows public routes without calling requireSession', async () => {
    const { context } = createHttpContext();
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);

    const result = await guard.canActivate(context);

    expect(result).toBe(true);
    expect(authService.requireSession).not.toHaveBeenCalled();
  });

  it('calls requireSession for non-public routes', async () => {
    const { context, request, response } = createHttpContext();
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    authService.requireSession.mockResolvedValue({ session: {}, user: {} });

    const result = await guard.canActivate(context);

    expect(result).toBe(true);
    expect(authService.requireSession).toHaveBeenCalledWith(request, response);
  });

  it('throws UnauthorizedException when requireSession throws', async () => {
    const { context } = createHttpContext();
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    authService.requireSession.mockRejectedValue(new UnauthorizedException('Authentication required.'));

    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it('allows non-HTTP contexts without calling requireSession', async () => {
    const context = {
      getType: vi.fn().mockReturnValue('rpc'),
    } as unknown as ExecutionContext;

    const result = await guard.canActivate(context);

    expect(result).toBe(true);
    expect(authService.requireSession).not.toHaveBeenCalled();
  });

  it('checks both handler and class metadata for @Public()', async () => {
    const { context } = createHttpContext();
    const spy = vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    authService.requireSession.mockResolvedValue({ session: {}, user: {} });

    await guard.canActivate(context);

    expect(spy).toHaveBeenCalledWith('auth:isPublicRoute', [context.getHandler(), context.getClass()]);
  });
});

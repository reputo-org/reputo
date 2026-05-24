import { UnauthorizedException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

function createMockRequest(url: string): Request {
  return {
    url,
    originalUrl: url,
    headers: {},
  } as unknown as Request;
}

function createMockResponse(): Response & { statusCode: number; body: unknown } {
  const res = {
    statusCode: 200,
    body: null as unknown,
    status: vi.fn().mockImplementation(function (this: any, code: number) {
      this.statusCode = code;
      return this;
    }),
    json: vi.fn().mockImplementation(function (this: any, data: unknown) {
      this.body = data;
      return this;
    }),
  };

  return res as any;
}

describe('docs protection middleware', () => {
  let protectedPaths: Map<string, (req: Request, res: Response, next: () => void) => void>;

  const authService = {
    requireSession: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    protectedPaths = new Map();

    const mockApp = {
      use: vi
        .fn()
        .mockImplementation(
          (
            pathOrMiddleware: string | ((...args: unknown[]) => unknown),
            ...rest: ((...args: unknown[]) => unknown)[]
          ) => {
            if (typeof pathOrMiddleware === 'string' && rest.length > 0) {
              if (!protectedPaths.has(pathOrMiddleware)) {
                protectedPaths.set(pathOrMiddleware, rest[0] as any);
              }
            }
          },
        ),
    };

    const mockDocument = { openapi: '3.0.0', info: { title: 'Test', version: '1.0' }, paths: {} };

    vi.doMock('@nestjs/swagger', () => ({
      SwaggerModule: {
        createDocument: vi.fn().mockReturnValue(mockDocument),
        setup: vi.fn(),
      },
      DocumentBuilder: vi.fn().mockReturnValue({
        setTitle: vi.fn().mockReturnThis(),
        setDescription: vi.fn().mockReturnThis(),
        setVersion: vi.fn().mockReturnThis(),
        addServer: vi.fn().mockReturnThis(),
        build: vi.fn().mockReturnValue({}),
      }),
    }));

    vi.doMock('@scalar/nestjs-api-reference', () => ({
      apiReference: vi.fn().mockReturnValue((_req: any, _res: any, next: any) => next()),
    }));

    const { setupSwagger } = await import('../../../src/docs/index');
    setupSwagger(mockApp as any, authService as any);
  });

  it('installs protection middleware on /docs, /docs-json, /docs-yaml, and /reference', () => {
    expect(protectedPaths.has('/docs')).toBe(true);
    expect(protectedPaths.has('/docs-json')).toBe(true);
    expect(protectedPaths.has('/docs-yaml')).toBe(true);
    expect(protectedPaths.has('/reference')).toBe(true);
  });

  it('calls next() when requireSession resolves successfully', async () => {
    authService.requireSession.mockResolvedValue({ session: {}, user: {} });

    const middleware = protectedPaths.get('/docs');
    if (!middleware) throw new Error('middleware not registered for /docs');
    const req = createMockRequest('/docs');
    const res = createMockResponse();
    const next = vi.fn();

    middleware(req, res, next);

    await vi.waitFor(() => expect(next).toHaveBeenCalledTimes(1));
  });

  it('returns 401 JSON when requireSession throws UnauthorizedException', async () => {
    authService.requireSession.mockRejectedValue(new UnauthorizedException('Authentication required.'));

    const middleware = protectedPaths.get('/docs');
    if (!middleware) throw new Error('middleware not registered for /docs');
    const req = createMockRequest('/docs');
    const res = createMockResponse();
    const next = vi.fn();

    middleware(req, res, next);

    await vi.waitFor(() => expect(res.status).toHaveBeenCalledWith(401));
    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
  });

  it('protects the /docs-json path (OpenAPI spec)', async () => {
    authService.requireSession.mockRejectedValue(new UnauthorizedException());

    const middleware = protectedPaths.get('/docs-json');
    if (!middleware) throw new Error('middleware not registered for /docs-json');
    const req = createMockRequest('/docs-json');
    const res = createMockResponse();
    const next = vi.fn();

    middleware(req, res, next);

    await vi.waitFor(() => expect(res.status).toHaveBeenCalledWith(401));
    expect(next).not.toHaveBeenCalled();
  });

  it('protects the /reference path (Scalar API reference)', async () => {
    authService.requireSession.mockRejectedValue(new UnauthorizedException());

    const middleware = protectedPaths.get('/reference');
    if (!middleware) throw new Error('middleware not registered for /reference');
    const req = createMockRequest('/reference');
    const res = createMockResponse();
    const next = vi.fn();

    middleware(req, res, next);

    await vi.waitFor(() => expect(res.status).toHaveBeenCalledWith(401));
    expect(next).not.toHaveBeenCalled();
  });
});

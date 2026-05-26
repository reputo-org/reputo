import { HttpStatus, UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { HttpExceptionFilter } from '../../../../src/shared/filters/http-exception.filter';

describe('HttpExceptionFilter', () => {
  it('redacts auth-sensitive fields from logs and response bodies', () => {
    const filter = new HttpExceptionFilter();
    const loggerError = vi.spyOn((filter as any).logger, 'error').mockImplementation(() => undefined);
    const json = vi.fn();
    const status = vi.fn(() => ({
      json,
    }));
    const response = { status } as any;
    const request = {
      body: {
        refreshToken: 'provider-refresh-token',
        nested: {
          client_secret: 'provider-client-secret',
        },
      },
      headers: {
        authorization: 'Bearer provider-access-token',
        cookie: 'reputo_test_session=session-id',
      },
      method: 'GET',
      params: {
        sessionId: 'session-id',
      },
      query: {
        code: 'auth-code',
        state: 'csrf-state',
      },
      url: '/api/v1/auth/deep-id/callback',
    };
    const host = {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => response,
      }),
    } as any;

    filter.catch(
      new UnauthorizedException({
        access_token: 'provider-access-token',
        message: 'Authentication required.',
      }),
      host,
    );

    expect(loggerError).toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({
          body: {
            nested: {
              client_secret: '[REDACTED]',
            },
            refreshToken: '[REDACTED]',
          },
          headers: expect.objectContaining({
            authorization: '[REDACTED]',
            cookie: '[REDACTED]',
          }),
          params: {
            sessionId: '[REDACTED]',
          },
          query: {
            code: '[REDACTED]',
            state: '[REDACTED]',
          },
        }),
        response: {
          access_token: '[REDACTED]',
          message: 'Authentication required.',
        },
      }),
    );
    expect(status).toHaveBeenCalledWith(HttpStatus.UNAUTHORIZED);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: {
          access_token: '[REDACTED]',
          message: 'Authentication required.',
        },
        path: '/api/v1/auth/deep-id/callback',
        statusCode: HttpStatus.UNAUTHORIZED,
      }),
    );
  });
});

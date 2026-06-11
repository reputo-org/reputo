import { HttpException, HttpStatus, type INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { apiReference } from '@scalar/nestjs-api-reference';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';

import type { AuthService } from '../auth';
import {
  SWAGGER_API_CURRENT_VERSION,
  SWAGGER_API_DESCRIPTION,
  SWAGGER_API_NAME,
  SWAGGER_API_ROOT,
} from '../shared/constants/swagger.constants';
import { createHttpErrorResponseBody } from '../shared/filters/http-exception.filter';

function normalizeMountedPath(path: string): string {
  return `/${path.replace(/^\/+/u, '')}`;
}

function createProtectedDocsMiddleware(authService: AuthService) {
  return (request: Request, response: Response, next: NextFunction) => {
    void authService.requireSession(request, response).then(
      () => next(),
      (exception: unknown) => {
        const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
        const message =
          status === HttpStatus.UNAUTHORIZED
            ? 'Unauthorized'
            : exception instanceof HttpException
              ? exception.getResponse()
              : 'Internal Server Error';

        response.status(status).json(createHttpErrorResponseBody(request.originalUrl || request.url, status, message));
      },
    );
  };
}

export const setupSwagger = (app: INestApplication, authService: AuthService) => {
  const config = new DocumentBuilder()
    .setTitle(SWAGGER_API_NAME)
    .setDescription(SWAGGER_API_DESCRIPTION)
    .setVersion(SWAGGER_API_CURRENT_VERSION)
    .addServer('/api/v1')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  const protectedDocsMiddleware = createProtectedDocsMiddleware(authService);
  const swaggerRoot = normalizeMountedPath(SWAGGER_API_ROOT);

  for (const path of [swaggerRoot, `${swaggerRoot}-json`, `${swaggerRoot}-yaml`, '/reference']) {
    app.use(path, protectedDocsMiddleware);
  }

  SwaggerModule.setup(SWAGGER_API_ROOT, app, document);

  app.use(
    '/reference',
    helmet.contentSecurityPolicy({
      directives: {
        ...helmet.contentSecurityPolicy.getDefaultDirectives(),
        'script-src': ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net'],
      },
    }),
  );

  app.use(
    '/reference',
    apiReference({
      content: document,
    }),
  );
};

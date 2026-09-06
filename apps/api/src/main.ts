import { ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { Logger, LoggerErrorInterceptor } from 'nestjs-pino';

import { AppModule } from './app.module';
import { AuthService } from './auth';
import { setupSwagger } from './docs';
import { HttpExceptionFilter } from './shared/filters/http-exception.filter';

async function bootstrap() {
  // `rawBody` keeps the exact bytes of a request alongside the parsed body, so
  // the GitHub webhook route can verify its HMAC signature — re-serialized JSON
  // would never match it.
  const app = await NestFactory.create(AppModule, { bufferLogs: true, rawBody: true });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
  app.useGlobalInterceptors(new LoggerErrorInterceptor());
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.use(helmet());
  app.enableCors({
    origin: true,
    credentials: true,
  });
  setupSwagger(app, app.get(AuthService));

  const configService = app.get(ConfigService);
  const port = configService.get('app.port');

  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
    prefix: 'api/v',
  });

  await app.listen(port, () => {
    const logger = app.get(Logger);
    logger.log(`Server is running on port ${port}`, 'NestApplication');
  });
}

bootstrap();

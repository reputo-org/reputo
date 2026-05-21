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
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  // Enable Nest shutdown hooks so OnApplicationShutdown providers (e.g. the
  // API Temporal activity worker) drain cleanly on SIGINT/SIGTERM.
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
    origin: true, // Allow all origins in development
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

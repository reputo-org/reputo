import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';

import { AdminModule } from './admin';
import { AlgorithmPresetModule } from './algorithm-preset/algorithm-preset.module';
import { AuthModule } from './auth';
import { configModules, validateEnv } from './config';
import { pinoConfig } from './config/pino.config';
import { ConsentModule } from './consent';
import { PersistenceModule } from './persistence';
import { SnapshotModule } from './snapshot/snapshot.module';
import { StorageModule } from './storage/storage.module';
import { ApiWorkerModule } from './temporal/api-worker.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      // Env vars come from the repo-root `.env` populated by
      // `scripts/env/load.ts` (via `pnpm dev` / `pnpm docker:dev`), or from the
      // container env in production. Don't let @nestjs/config silently load
      // `apps/api/.env` from cwd — there is no per-app env file anymore.
      ignoreEnvFile: true,
      load: configModules,
      validate: validateEnv,
      isGlobal: true,
    }),
    LoggerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: pinoConfig,
    }),
    PersistenceModule,
    AuthModule,
    AdminModule,
    ConsentModule,
    AlgorithmPresetModule,
    SnapshotModule,
    StorageModule,
    ApiWorkerModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}

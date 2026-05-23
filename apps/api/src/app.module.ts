import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';

import { AdminModule } from './admin';
import { AlgorithmPresetModule } from './algorithm-preset/algorithm-preset.module';
import { AuthModule } from './auth';
import { configModules, configValidationSchema } from './config';
import { pinoConfig } from './config/pino.config';
import { ConsentModule } from './consent';
import { PersistenceModule } from './persistence';
import { SnapshotModule } from './snapshot/snapshot.module';
import { StorageModule } from './storage/storage.module';
import { ApiWorkerModule } from './temporal/api-worker.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      load: configModules,
      validationSchema: configValidationSchema,
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

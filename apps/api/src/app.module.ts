import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { LoggerModule } from 'nestjs-pino';

import { AdminModule } from './admin';
import { AlgorithmPresetModule } from './algorithm-preset/algorithm-preset.module';
import { AuthModule } from './auth';
import { configModules, configValidationSchema } from './config';
import { pinoConfig } from './config/pino.config';
import { ConsentModule } from './consent';
import { SnapshotModule } from './snapshot/snapshot.module';
import { StorageModule } from './storage/storage.module';

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
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        uri: configService.get<string>('mongoDB.uri'),
      }),
    }),
    AuthModule,
    AdminModule,
    ConsentModule,
    AlgorithmPresetModule,
    SnapshotModule,
    StorageModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}

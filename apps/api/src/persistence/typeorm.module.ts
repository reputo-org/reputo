import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule, type TypeOrmModuleOptions } from '@nestjs/typeorm';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';
import { ENTITIES } from './entities';
import { MIGRATIONS } from './migrations';
import { SnapshotListenerService } from './snapshot-listener.service';

@Global()
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService): TypeOrmModuleOptions => ({
        type: 'postgres',
        url: config.get<string>('database.url'),
        entities: [...ENTITIES],
        migrations: [...MIGRATIONS],
        namingStrategy: new SnakeNamingStrategy(),
        synchronize: false,
        migrationsRun: false,
        autoLoadEntities: false,
        logging: false,
      }),
    }),
  ],
  providers: [SnapshotListenerService],
  exports: [TypeOrmModule, SnapshotListenerService],
})
export class PersistenceModule {}

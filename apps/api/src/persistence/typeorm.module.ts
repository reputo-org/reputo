import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule, type TypeOrmModuleOptions } from '@nestjs/typeorm';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';
import { ENTITIES } from './entities';
import { MIGRATIONS } from './migrations';
import { SnapshotListenerService } from './snapshot-listener.service';

// `@Global` so feature modules can `TypeOrmModule.forFeature([...])` without
// re-importing the root module. Mirrors how `ConfigModule` is registered.
//
// `SnapshotListenerService` lives here too because it owns a long-lived
// `pg.Client` LISTEN connection that is part of the persistence layer
// (separate from TypeORM's pool — see the service docstring).
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
        // Never sync in production — the migration file is the source of
        // truth. Tests opt into `runMigrations()` in bootstrap.
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

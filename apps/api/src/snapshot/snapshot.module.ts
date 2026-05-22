import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AlgorithmPresetModule } from '../algorithm-preset/algorithm-preset.module';
import { SnapshotEntity, SnapshotOutputEntity } from '../persistence';
import { StorageModule } from '../storage/storage.module';
import { TemporalModule } from '../temporal';
import { SnapshotController } from './snapshot.controller';
import { SnapshotRepository } from './snapshot.repository';
import { SnapshotService } from './snapshot.service';
import { SnapshotEventsService } from './snapshot-events.service';

// Persistence (repository, service) is TypeORM-backed via repositories
// registered with `TypeOrmModule.forFeature(...)`. Real-time SSE consumes
// `SnapshotListenerService` (PG `LISTEN/NOTIFY`), provided globally by
// `PersistenceModule`.
@Module({
  imports: [
    TypeOrmModule.forFeature([SnapshotEntity, SnapshotOutputEntity]),
    forwardRef(() => AlgorithmPresetModule),
    TemporalModule,
    StorageModule,
  ],
  controllers: [SnapshotController],
  providers: [SnapshotRepository, SnapshotService, SnapshotEventsService],
  exports: [SnapshotService, SnapshotRepository],
})
export class SnapshotModule {}

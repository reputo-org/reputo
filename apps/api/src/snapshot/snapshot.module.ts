import { forwardRef, Module } from '@nestjs/common';
import { AlgorithmPresetModule } from '../algorithm-preset/algorithm-preset.module';
import { StorageModule } from '../storage/storage.module';
import { TemporalModule } from '../temporal';
import { SnapshotController } from './snapshot.controller';
import { SnapshotRepository } from './snapshot.repository';
import { SnapshotService } from './snapshot.service';
import { SnapshotEventsService } from './snapshot-events.service';

// Persistence (repository, service) is Prisma-backed and uses the global
// `PrismaService`. Real-time SSE consumes `SnapshotListenerService` (PG
// `LISTEN/NOTIFY`), also provided globally by `PrismaModule`.
@Module({
  imports: [forwardRef(() => AlgorithmPresetModule), TemporalModule, StorageModule],
  controllers: [SnapshotController],
  providers: [SnapshotRepository, SnapshotService, SnapshotEventsService],
  exports: [SnapshotService, SnapshotRepository],
})
export class SnapshotModule {}

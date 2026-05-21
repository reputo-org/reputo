import { forwardRef, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MODEL_NAMES, SnapshotSchema } from '@reputo/database';
import { AlgorithmPresetModule } from '../algorithm-preset/algorithm-preset.module';
import { StorageModule } from '../storage/storage.module';
import { TemporalModule } from '../temporal';
import { SnapshotController } from './snapshot.controller';
import { SnapshotRepository } from './snapshot.repository';
import { SnapshotService } from './snapshot.service';
import { SnapshotEventsService } from './snapshot-events.service';

// SSE replacement (PG LISTEN/NOTIFY) lands in task 09 — until then the SSE
// service still uses the Mongoose change stream, so the Snapshot model is
// registered here exclusively for that consumer. Persistence (repository,
// service) is fully Prisma-backed and uses the global PrismaService.
@Module({
  imports: [
    MongooseModule.forFeature([{ name: MODEL_NAMES.SNAPSHOT, schema: SnapshotSchema }]),
    forwardRef(() => AlgorithmPresetModule),
    TemporalModule,
    StorageModule,
  ],
  controllers: [SnapshotController],
  providers: [SnapshotRepository, SnapshotService, SnapshotEventsService],
  exports: [SnapshotService, SnapshotRepository],
})
export class SnapshotModule {}

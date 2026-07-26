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
import { SnapshotReconcilerService } from './snapshot-reconciler.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([SnapshotEntity, SnapshotOutputEntity]),
    forwardRef(() => AlgorithmPresetModule),
    TemporalModule,
    StorageModule,
  ],
  controllers: [SnapshotController],
  providers: [SnapshotRepository, SnapshotService, SnapshotEventsService, SnapshotReconcilerService],
  exports: [SnapshotService, SnapshotRepository],
})
export class SnapshotModule {}

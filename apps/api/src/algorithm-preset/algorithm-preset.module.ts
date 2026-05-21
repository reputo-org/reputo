import { forwardRef, Module } from '@nestjs/common';
import { SnapshotModule } from '../snapshot/snapshot.module';
import { StorageModule } from '../storage/storage.module';
import { TemporalModule } from '../temporal';
import { AlgorithmPresetController } from './algorithm-preset.controller';
import { AlgorithmPresetRepository } from './algorithm-preset.repository';
import { AlgorithmPresetService } from './algorithm-preset.service';

// PrismaModule is registered globally in `src/persistence`, so feature
// modules can depend on `PrismaService` directly without importing it here.
@Module({
  imports: [StorageModule, TemporalModule, forwardRef(() => SnapshotModule)],
  controllers: [AlgorithmPresetController],
  providers: [AlgorithmPresetRepository, AlgorithmPresetService],
  exports: [AlgorithmPresetService, AlgorithmPresetRepository],
})
export class AlgorithmPresetModule {}

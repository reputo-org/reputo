import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AlgorithmPresetEntity, AlgorithmPresetInputEntity } from '../persistence';
import { SnapshotModule } from '../snapshot/snapshot.module';
import { StorageModule } from '../storage/storage.module';
import { TemporalModule } from '../temporal';
import { AlgorithmPresetController } from './algorithm-preset.controller';
import { AlgorithmPresetRepository } from './algorithm-preset.repository';
import { AlgorithmPresetService } from './algorithm-preset.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([AlgorithmPresetEntity, AlgorithmPresetInputEntity]),
    StorageModule,
    TemporalModule,
    forwardRef(() => SnapshotModule),
  ],
  controllers: [AlgorithmPresetController],
  providers: [AlgorithmPresetRepository, AlgorithmPresetService],
  exports: [AlgorithmPresetService, AlgorithmPresetRepository],
})
export class AlgorithmPresetModule {}

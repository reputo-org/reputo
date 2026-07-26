import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ApiWorkerStatus } from './api-worker.status';
import { TemporalService } from './temporal.service';

@Module({
  imports: [ConfigModule],
  providers: [TemporalService, ApiWorkerStatus],
  exports: [TemporalService, ApiWorkerStatus],
})
export class TemporalModule {}

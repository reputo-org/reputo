import { Module } from '@nestjs/common';
import { TemporalModule } from '../temporal';
import { HealthController } from './health.controller';

@Module({
  imports: [TemporalModule],
  controllers: [HealthController],
})
export class HealthModule {}

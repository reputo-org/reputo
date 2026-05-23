import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SNAPSHOT_STATUS, type SnapshotStatus } from '@reputo/contracts';

class SnapshotEventDataDto {
  @ApiProperty({
    description: 'Snapshot unique identifier (UUID v7)',
    example: '01940000-0000-7000-8000-000000000000',
  })
  _id: string;

  @ApiProperty({
    description: 'Current execution status',
    enum: SNAPSHOT_STATUS,
    example: 'running',
  })
  status: SnapshotStatus;

  @ApiPropertyOptional({
    description: 'Reference to the associated AlgorithmPreset (UUID v7)',
    example: '01940000-0000-7000-8000-000000000000',
  })
  algorithmPreset?: string;

  @ApiPropertyOptional({
    description: 'Algorithm execution outputs',
    type: 'object',
    additionalProperties: true,
  })
  outputs?: Record<string, unknown>;

  @ApiPropertyOptional({
    description: 'Timestamp when execution started',
    example: '2025-10-13T19:12:03.010Z',
  })
  startedAt?: string;

  @ApiPropertyOptional({
    description: 'Timestamp when execution completed',
    example: '2025-10-13T19:12:44.600Z',
  })
  completedAt?: string;

  @ApiProperty({
    description: 'Last update timestamp',
    example: '2025-10-13T19:12:44.600Z',
  })
  updatedAt: string;
}

export class SnapshotEventDto {
  @ApiProperty({
    description: 'Event type',
    example: 'snapshot:updated',
  })
  type: 'snapshot:updated';

  @ApiProperty({
    description: 'Event payload with snapshot data',
    type: SnapshotEventDataDto,
  })
  data: SnapshotEventDataDto;
}

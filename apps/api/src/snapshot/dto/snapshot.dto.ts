import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  SNAPSHOT_PUBLICATION_STATUSES,
  SNAPSHOT_STATUS,
  type SnapshotPublicationCounts,
  type SnapshotPublicationStatus,
  type SnapshotStatus,
} from '@reputo/contracts';

class AlgorithmPresetFrozenDto {
  @ApiProperty({
    description: 'Unique algorithm identifier',
    example: 'voting_engagement',
  })
  key: string;

  @ApiProperty({
    description: 'Algorithm version',
    example: '1.0.0',
  })
  version: string;

  @ApiProperty({
    description: 'Array of input parameters',
    type: 'array',
    items: {
      type: 'object',
      properties: {
        key: { type: 'string' },
        value: {},
      },
    },
  })
  inputs: Array<{ key: string; value?: unknown }>;

  @ApiPropertyOptional({
    description: 'Human-readable name',
    example: 'Voting engagement v1',
  })
  name?: string;

  @ApiPropertyOptional({
    description: 'Description of the preset',
    example: 'Reputo test',
  })
  description?: string;

  @ApiPropertyOptional({
    description: 'Creation timestamp (ISO 8601)',
    example: '2025-10-13T18:22:47.100Z',
  })
  createdAt?: string;

  @ApiPropertyOptional({
    description: 'Last update timestamp (ISO 8601)',
    example: '2025-10-13T18:22:47.100Z',
  })
  updatedAt?: string;
}

class SnapshotTemporalDto {
  @ApiPropertyOptional({
    description: 'Temporal workflow ID',
    example: 'wf-voting-engagement-abc123',
  })
  workflowId?: string;

  @ApiPropertyOptional({
    description: 'Temporal workflow run ID',
    example: 'a1b2c3',
  })
  runId?: string;

  @ApiPropertyOptional({
    description: 'Temporal task queue name',
    example: 'algorithms',
  })
  taskQueue?: string;
}

class SnapshotOutputsDto {
  @ApiPropertyOptional({
    description: 'S3 key or identifier for CSV output',
    example: 's3://bucket/path/result.csv',
  })
  csv?: string;
}

class SnapshotErrorDto {
  @ApiProperty({
    description: 'Why the run failed or was cancelled',
    example: 'Child algorithm "voting_engagement" result is missing a did value',
  })
  message: string;

  @ApiPropertyOptional({
    description: 'When the error was recorded (ISO 8601)',
    example: '2025-10-13T19:12:44.600Z',
  })
  timestamp?: string;
}

export class SnapshotPublicationDto {
  @ApiProperty({
    description: 'Algorithm key the scores were published under',
    example: 'discord_engagement',
  })
  algorithmKey: string;

  @ApiProperty({
    description: 'Publication status',
    enum: SNAPSHOT_PUBLICATION_STATUSES,
    example: 'sent',
  })
  status: SnapshotPublicationStatus;

  @ApiPropertyOptional({
    description: 'Row counts of the posting pass',
    type: 'object',
    properties: {
      posted: { type: 'number' },
      ok: { type: 'number' },
      failed: { type: 'number' },
      dropped: { type: 'number' },
      skipped: { type: 'number' },
    },
    additionalProperties: false,
  })
  counts?: SnapshotPublicationCounts;

  @ApiPropertyOptional({
    description: 'Safe error category or summary of a failed publication',
    example: 'DeepID rejected the request',
  })
  error?: string;

  @ApiProperty({
    description: 'Creation timestamp (ISO 8601)',
    example: '2026-08-29T10:00:00.000Z',
  })
  createdAt: string;

  @ApiProperty({
    description: 'Last update timestamp (ISO 8601)',
    example: '2026-08-29T10:00:05.000Z',
  })
  updatedAt: string;
}

export class SnapshotDto {
  @ApiProperty({
    description: 'Unique identifier (UUID v7)',
    example: '01940000-0000-7000-8000-000000000000',
  })
  _id: string;

  @ApiProperty({
    description: 'Current execution status',
    enum: SNAPSHOT_STATUS,
    example: 'completed',
  })
  status: SnapshotStatus;

  @ApiPropertyOptional({
    description: 'Temporal workflow information',
    type: SnapshotTemporalDto,
  })
  temporal?: SnapshotTemporalDto;

  @ApiProperty({
    description: 'Reference to the associated AlgorithmPreset (UUID v7)',
    example: '01940000-0000-7000-8000-000000000000',
  })
  algorithmPreset: string;

  @ApiProperty({
    description: 'Frozen copy of the associated AlgorithmPreset at snapshot creation time',
    type: AlgorithmPresetFrozenDto,
  })
  algorithmPresetFrozen: AlgorithmPresetFrozenDto;

  @ApiPropertyOptional({
    description: 'Algorithm execution outputs with CSV key',
    type: SnapshotOutputsDto,
  })
  outputs?: SnapshotOutputsDto;

  @ApiPropertyOptional({
    description: 'Last run error, set when the snapshot failed or was cancelled',
    type: SnapshotErrorDto,
  })
  error?: SnapshotErrorDto;

  @ApiPropertyOptional({
    description: 'DeepID publication status per algorithm key',
    type: [SnapshotPublicationDto],
  })
  publications?: SnapshotPublicationDto[];

  @ApiPropertyOptional({
    description: 'Timestamp when execution started (status changed to running, ISO 8601)',
    example: '2025-10-13T19:12:05.000Z',
  })
  startedAt?: string;

  @ApiPropertyOptional({
    description: 'Timestamp when execution completed (status changed to completed or failed, ISO 8601)',
    example: '2025-10-13T19:12:44.600Z',
  })
  completedAt?: string;

  @ApiProperty({
    description: 'Creation timestamp (ISO 8601)',
    example: '2025-10-13T19:12:03.010Z',
  })
  createdAt: string;

  @ApiProperty({
    description: 'Last update timestamp (ISO 8601)',
    example: '2025-10-13T19:12:44.600Z',
  })
  updatedAt: string;
}

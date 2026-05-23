import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, IsUUID, ValidateNested } from 'class-validator';

class SnapshotTemporalDto {
  @ApiPropertyOptional({
    description: 'Temporal workflow ID',
    example: 'wf-voting-engagement-abc123',
  })
  @IsString()
  @IsOptional()
  workflowId?: string;

  @ApiPropertyOptional({
    description: 'Temporal workflow run ID',
    example: 'a1b2c3',
  })
  @IsString()
  @IsOptional()
  runId?: string;

  @ApiPropertyOptional({
    description: 'Temporal task queue name',
    example: 'algorithms',
  })
  @IsString()
  @IsOptional()
  taskQueue?: string;
}

class SnapshotOutputsDto {
  @ApiPropertyOptional({
    description: 'S3 key or identifier for CSV output',
    example: 's3://bucket/path/result.csv',
  })
  @IsString()
  @IsOptional()
  csv?: string;
}

export class CreateSnapshotDto {
  /**
   * AlgorithmPreset ID that will be resolved and embedded as a frozen copy in the snapshot.
   * The service fetches the full preset and stores it as algorithmPresetFrozen with the same input values.
   */
  @ApiProperty({
    description: 'AlgorithmPreset ID (UUID v7) to embed as frozen preset in the snapshot',
    example: '01940000-0000-7000-8000-000000000000',
  })
  @IsUUID('7')
  @IsNotEmpty()
  algorithmPresetId: string;

  @ApiPropertyOptional({
    description: 'Optional Temporal workflow information',
    type: SnapshotTemporalDto,
  })
  @ValidateNested()
  @Type(() => SnapshotTemporalDto)
  @IsOptional()
  temporal?: SnapshotTemporalDto;

  @ApiPropertyOptional({
    description: 'Algorithm execution outputs with CSV key',
    type: SnapshotOutputsDto,
  })
  @ValidateNested()
  @Type(() => SnapshotOutputsDto)
  @IsOptional()
  outputs?: SnapshotOutputsDto;
}

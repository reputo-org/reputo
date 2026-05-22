import { ApiPropertyOptional } from '@nestjs/swagger';
import { SNAPSHOT_STATUS, type SnapshotStatus } from '@reputo/contracts';
import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../shared/dto';

export class ListSnapshotsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Filter by execution status',
    enum: SNAPSHOT_STATUS,
    example: 'completed',
  })
  @IsEnum(SNAPSHOT_STATUS)
  @IsOptional()
  status?: SnapshotStatus;

  @ApiPropertyOptional({
    description: 'Filter by algorithm preset ID (UUID v7)',
    example: '01940000-0000-7000-8000-000000000000',
  })
  @IsUUID('7')
  @IsOptional()
  algorithmPreset?: string;

  @ApiPropertyOptional({
    description: 'Filter by algorithm key (from algorithmPresetFrozen)',
    example: 'voting_engagement',
  })
  @IsString()
  @IsOptional()
  key?: string;

  @ApiPropertyOptional({
    description: 'Filter by algorithm version (from algorithmPresetFrozen)',
    example: '1.0.0',
  })
  @IsString()
  @IsOptional()
  version?: string;
}

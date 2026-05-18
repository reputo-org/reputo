import { ApiProperty } from '@nestjs/swagger';
import { AdminViewDto } from './admin-view.dto';

export class AdminListResponseDto {
  @ApiProperty({ type: [AdminViewDto] })
  results: AdminViewDto[];

  @ApiProperty({ description: 'Current page (1-indexed).', example: 1 })
  page: number;

  @ApiProperty({ description: 'Maximum results per page.', example: 20 })
  limit: number;

  @ApiProperty({ description: 'Total matching documents.', example: 47 })
  totalResults: number;

  @ApiProperty({ description: 'Total pages for the matching set.', example: 3 })
  totalPages: number;
}

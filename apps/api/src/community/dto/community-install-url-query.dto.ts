import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

export class CommunityInstallUrlQueryDto {
  @ApiPropertyOptional({
    description:
      'Connection being reconnected. Where the platform allows it, the authorization screen is locked to that community.',
    example: '01940000-0000-7000-8000-000000000000',
  })
  @IsUUID('7')
  @IsOptional()
  connectionId?: string;
}

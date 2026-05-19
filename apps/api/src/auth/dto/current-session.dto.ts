import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ACCESS_ROLES } from '@reputo/database';

export class CurrentSessionUserDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  provider!: string;

  @ApiProperty({ enum: ACCESS_ROLES })
  role!: string;

  @ApiProperty()
  sub!: string;

  @ApiPropertyOptional({ type: [String] })
  aud?: string[];

  @ApiPropertyOptional()
  auth_time?: number;

  @ApiPropertyOptional()
  email?: string;

  @ApiPropertyOptional()
  email_verified?: boolean;

  @ApiPropertyOptional()
  iat?: number;

  @ApiPropertyOptional()
  iss?: string;

  @ApiPropertyOptional()
  picture?: string;

  @ApiPropertyOptional()
  rat?: number;

  @ApiPropertyOptional()
  username?: string;

  @ApiPropertyOptional({ example: '2026-05-02T10:00:00.000Z' })
  createdAt?: string;

  @ApiPropertyOptional({ example: '2026-05-02T10:00:00.000Z' })
  updatedAt?: string;
}

export class CurrentSessionDto {
  @ApiProperty()
  authenticated!: boolean;

  @ApiPropertyOptional({ example: 'deep-id' })
  provider?: string;

  @ApiPropertyOptional({ enum: ACCESS_ROLES })
  role?: string;

  @ApiPropertyOptional({ example: '2026-05-02T10:00:00.000Z' })
  expiresAt?: string;

  @ApiPropertyOptional({ type: [String] })
  scope?: string[];

  @ApiPropertyOptional({ type: CurrentSessionUserDto })
  user?: CurrentSessionUserDto;
}

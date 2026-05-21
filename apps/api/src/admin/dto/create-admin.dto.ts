import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ACCESS_ROLE_ADMIN,
  ACCESS_ROLES,
  type AccessRole,
  OAUTH_PROVIDERS,
  type OAuthProvider,
} from '@reputo/contracts';
import { Transform } from 'class-transformer';
import { IsEmail, IsIn, IsOptional, IsString } from 'class-validator';

export class CreateAdminDto {
  @ApiProperty({
    description: 'Upstream auth provider identifier.',
    enum: OAUTH_PROVIDERS,
  })
  @IsIn(OAUTH_PROVIDERS as unknown as string[])
  provider: OAuthProvider;

  @ApiProperty({
    description: 'Email address to add to the admin allowlist.',
    example: 'admin@example.com',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsString()
  @IsEmail()
  email: string;

  @ApiPropertyOptional({
    description: 'Role granted to the new entry. Defaults to admin.',
    enum: ACCESS_ROLES,
    default: ACCESS_ROLE_ADMIN,
  })
  @IsOptional()
  @IsIn(ACCESS_ROLES as unknown as string[])
  role?: AccessRole;
}

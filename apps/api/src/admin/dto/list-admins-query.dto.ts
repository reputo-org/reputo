import { ApiPropertyOptional } from '@nestjs/swagger';
import { ACCESS_ROLES, type AccessRole, OAUTH_PROVIDERS, type OAuthProvider } from '@reputo/contracts';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import {
  ADMIN_ALLOWLIST_SORT_FIELDS,
  ADMIN_ALLOWLIST_SORT_ORDERS,
  ADMIN_ALLOWLIST_STATUSES,
  type AdminAllowlistSortField,
  type AdminAllowlistSortOrder,
  type AdminAllowlistStatus,
} from '../admin.constants';

function toBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const lowered = value.trim().toLowerCase();
    if (lowered === 'true' || lowered === '1') return true;
    if (lowered === 'false' || lowered === '0') return false;
  }
  return undefined;
}

export class ListAdminsQueryDto {
  @ApiPropertyOptional({
    description: 'Filter by upstream auth provider.',
    enum: OAUTH_PROVIDERS,
  })
  @IsOptional()
  @IsIn(OAUTH_PROVIDERS as unknown as string[])
  provider?: OAuthProvider;

  @ApiPropertyOptional({
    description: 'Filter by access role.',
    enum: ACCESS_ROLES,
  })
  @IsOptional()
  @IsIn(ACCESS_ROLES as unknown as string[])
  role?: AccessRole;

  @ApiPropertyOptional({
    description: 'Status filter. Defaults to active.',
    enum: ADMIN_ALLOWLIST_STATUSES,
    default: 'active',
  })
  @IsOptional()
  @IsIn(ADMIN_ALLOWLIST_STATUSES as unknown as string[])
  status?: AdminAllowlistStatus;

  @ApiPropertyOptional({
    description: 'Email prefix search (case-insensitive).',
    example: 'admin',
  })
  @IsOptional()
  @IsString()
  q?: string;

  @ApiPropertyOptional({
    description: 'Sort field.',
    enum: ADMIN_ALLOWLIST_SORT_FIELDS,
    default: 'email',
  })
  @IsOptional()
  @IsIn(ADMIN_ALLOWLIST_SORT_FIELDS as unknown as string[])
  sortField?: AdminAllowlistSortField;

  @ApiPropertyOptional({
    description: 'Sort order.',
    enum: ADMIN_ALLOWLIST_SORT_ORDERS,
    default: 'asc',
  })
  @IsOptional()
  @IsIn(ADMIN_ALLOWLIST_SORT_ORDERS as unknown as string[])
  sortOrder?: AdminAllowlistSortOrder;

  @ApiPropertyOptional({
    description: 'Page number (1-indexed).',
    minimum: 1,
    default: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({
    description: 'Maximum results per page.',
    minimum: 1,
    maximum: 100,
    default: 20,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({
    description: 'Include sessions activity (last sign-in, active session count).',
    default: false,
  })
  @IsOptional()
  @Transform(({ value }) => toBoolean(value) ?? false)
  @IsBoolean()
  includeSessions?: boolean;
}

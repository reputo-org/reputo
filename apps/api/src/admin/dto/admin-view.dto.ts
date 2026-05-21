import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ACCESS_ROLES, type AccessRole, OAUTH_PROVIDERS, type OAuthProvider } from '@reputo/contracts';

export class AdminViewDto {
  @ApiProperty({
    description: 'Upstream auth provider identifier.',
    enum: OAUTH_PROVIDERS,
  })
  provider: OAuthProvider;

  @ApiProperty({
    description: 'Allowlisted email address.',
    example: 'owner@example.com',
  })
  email: string;

  @ApiProperty({
    description: 'Access role granted to the email address.',
    enum: ACCESS_ROLES,
  })
  role: AccessRole;

  @ApiProperty({
    description: 'Invitation timestamp.',
    example: '2026-05-12T10:00:00.000Z',
  })
  invitedAt: string;

  @ApiPropertyOptional({
    description: 'Email address of the user that invited this row.',
    example: 'owner@example.com',
  })
  invitedByEmail?: string;

  @ApiPropertyOptional({
    description: 'Timestamp at which this row was revoked, when present.',
    example: '2026-05-13T10:00:00.000Z',
  })
  revokedAt?: string;

  @ApiPropertyOptional({
    description: 'Email address of the user that revoked this row.',
    example: 'owner@example.com',
  })
  revokedByEmail?: string;

  @ApiPropertyOptional({
    description: 'Most recent successful sign-in timestamp for this email, when activity is included.',
    example: '2026-05-14T08:00:00.000Z',
  })
  lastSignInAt?: string;

  @ApiPropertyOptional({
    description: 'Number of currently active (non-revoked, non-expired) sessions for this email.',
    example: 2,
  })
  activeSessionCount?: number;

  @ApiPropertyOptional({
    description: 'Whether this email has ever signed in successfully through the upstream provider.',
    example: true,
  })
  hasEverSignedIn?: boolean;
}

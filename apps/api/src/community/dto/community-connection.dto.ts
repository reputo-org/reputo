import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  COMMUNITY_CONNECTION_STATUSES,
  COMMUNITY_PLATFORMS,
  COMMUNITY_RESOURCE_ACCESS_ISSUES,
  COMMUNITY_RESOURCE_KINDS,
  type CommunityConnectionDto as CommunityConnectionContract,
  type CommunityConnectionEventDto as CommunityConnectionEventContract,
  type CommunityConnectionMetadataDto as CommunityConnectionMetadataContract,
  type CommunityConnectionStatus,
  type CommunityHealthDto as CommunityHealthContract,
  type CommunityPlatform,
  type CommunityResourceAccessIssue,
  type CommunityResourceDto as CommunityResourceContract,
} from '@reputo/contracts';

const COMMUNITY_CONNECTION_EVENT_TYPES: ReadonlyArray<CommunityConnectionEventContract['type']> = [
  'community_connection:updated',
  'community_connection:removed',
  'community_connection:watch',
  'community_connection:heartbeat',
];

export class CommunityConnectionMetadataDto implements CommunityConnectionMetadataContract {
  @ApiPropertyOptional({
    description: 'Public icon URL of the community, when the platform serves one unauthenticated.',
    example: 'https://cdn.discordapp.com/icons/974492421130127923/a1b2c3.png?size=128',
  })
  avatarUrl?: string;

  @ApiPropertyOptional({ description: 'Approximate member count the platform reports.', example: 1874 })
  memberCount?: number;

  @ApiPropertyOptional({ description: 'Selectable resources the last successful probe counted.', example: 12 })
  resourceCount?: number;

  @ApiPropertyOptional({
    description: "Of those, the resources the pipeline can read under the bot's current access.",
    example: 10,
  })
  readableResourceCount?: number;
}

export class CommunityConnectionDto implements CommunityConnectionContract {
  @ApiProperty({ description: 'Connection identifier.', example: '01940000-0000-7000-8000-000000000000' })
  id: string;

  @ApiProperty({ description: 'Connected platform.', enum: COMMUNITY_PLATFORMS })
  platform: CommunityPlatform;

  @ApiProperty({ description: 'Platform-side community identifier.', example: '974492421130127923' })
  externalId: string;

  @ApiProperty({ description: 'Community name as the platform reports it.', example: 'SingularityNET' })
  name: string;

  @ApiProperty({ description: 'Connection lifecycle state.', enum: COMMUNITY_CONNECTION_STATUSES })
  status: CommunityConnectionStatus;

  @ApiPropertyOptional({
    description: 'Why the last operation failed. Present while the connection is not active.',
    example: 'The platform rejected the bot credentials. Reconnect to authorize it again.',
  })
  statusReason?: string;

  @ApiPropertyOptional({
    description:
      'When the platform last confirmed this state. Health is checked on connect, on demand, per snapshot, periodically by the API health sweep, and every watch interval while a client follows the events stream.',
    example: '2026-08-26T10:00:00.000Z',
  })
  lastCheckedAt?: string;

  @ApiPropertyOptional({
    description: 'Display facts from the last successful probe. Kept across later failed probes.',
    type: CommunityConnectionMetadataDto,
  })
  metadata?: CommunityConnectionMetadataDto;

  @ApiProperty({ description: 'Creation timestamp.', example: '2026-08-26T10:00:00.000Z' })
  createdAt: string;

  @ApiProperty({ description: 'Last update timestamp.', example: '2026-08-26T10:00:00.000Z' })
  updatedAt: string;
}

export class CommunityResourceDto implements CommunityResourceContract {
  @ApiProperty({ description: 'Platform-side resource identifier.', example: '1029384756102938475' })
  id: string;

  @ApiProperty({ description: 'Resource name.', example: 'general' })
  name: string;

  @ApiProperty({ description: 'Resource kind.', enum: COMMUNITY_RESOURCE_KINDS })
  kind: CommunityResourceContract['kind'];

  @ApiProperty({
    description: "Whether the pipeline can read this resource under the bot's current access.",
    example: true,
  })
  readable: boolean;

  @ApiPropertyOptional({
    description: 'Why the resource is unreadable; absent when it is readable.',
    enum: COMMUNITY_RESOURCE_ACCESS_ISSUES,
  })
  accessIssue?: CommunityResourceAccessIssue;
}

export class CommunityConnectionEventDto {
  @ApiProperty({ description: 'Event type.', enum: COMMUNITY_CONNECTION_EVENT_TYPES })
  type: CommunityConnectionEventContract['type'];

  @ApiProperty({
    description:
      'Event payload: the connection for `updated`, `{ id }` for `removed`, `{ intervalMs }` for `watch` — the re-probe cadence while a client is subscribed, `0` when disabled — and `{ at }` for the periodic `heartbeat`.',
    type: 'object',
    additionalProperties: true,
  })
  data: CommunityConnectionEventContract['data'];
}

export class CommunityHealthDto implements CommunityHealthContract {
  @ApiProperty({ description: 'Lifecycle state after the probe.', enum: COMMUNITY_CONNECTION_STATUSES })
  status: CommunityConnectionStatus;

  @ApiProperty({ description: 'When the probe ran.', example: '2026-08-26T10:00:00.000Z' })
  checkedAt: string;

  @ApiPropertyOptional({
    description: 'Why the probe did not succeed.',
    example: 'The bot is missing View Channels or Read Message History. Reconnect and grant both.',
  })
  reason?: string;
}

export class CommunityInstallUrlDto {
  @ApiProperty({
    description: 'Authorization URL the admin opens to install Reputo on the platform.',
    example: 'https://discord.com/oauth2/authorize?client_id=...&scope=bot',
  })
  url: string;
}

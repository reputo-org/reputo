export interface SpecDto {
  key: string
  version: string
}

export interface InputDto {
  key: string
  value?: unknown
}

export interface CreateAlgorithmPresetDto {
  key: string
  version: string
  inputs: InputDto[]
  name?: string
  description?: string
}

export interface SpecResponseDto {
  key: string
  version: string
}

export interface InputResponseDto {
  key: string
  value?: unknown
}

export interface AlgorithmPresetResponseDto {
  _id: string
  key: string
  version: string
  inputs: InputResponseDto[]
  name?: string
  description?: string
  createdAt: string
  updatedAt: string
}

export interface PaginatedAlgorithmPresetResponseDto {
  results: AlgorithmPresetResponseDto[]
  page: number
  limit: number
  totalPages: number
  totalResults: number
}

export interface UpdateAlgorithmPresetDto {
  inputs?: InputDto[]
  name?: string
  description?: string
}

export interface TemporalDto {
  workflowId?: string
  runId?: string
  taskQueue?: string
}

export interface CreateSnapshotDto {
  algorithmPresetId: string
  temporal?: TemporalDto
  outputs?: Record<string, unknown>
}

export interface TemporalResponseDto {
  workflowId?: string
  runId?: string
  taskQueue?: string
}

export interface AlgorithmPresetFrozenDto {
  key: string
  version: string
  inputs: InputResponseDto[]
  name?: string
  description?: string
  _id: string
  createdAt: string
  updatedAt: string
}

export interface SnapshotPublicationDto {
  algorithmKey: string
  status: "pending" | "sent" | "failed"
  counts?: {
    posted: number
    ok: number
    failed: number
    dropped: number
    skipped: number
  }
  error?: string
  createdAt: string
  updatedAt: string
}

export interface SnapshotResponseDto {
  _id: string
  status: "queued" | "running" | "completed" | "failed" | "cancelled"
  temporal?: TemporalResponseDto
  algorithmPreset: string
  algorithmPresetFrozen?: AlgorithmPresetFrozenDto
  outputs?: Record<string, unknown>
  publications?: SnapshotPublicationDto[]
  startedAt?: string
  completedAt?: string
  createdAt: string
  updatedAt: string
}

export interface PaginatedSnapshotResponseDto {
  results: SnapshotResponseDto[]
  page: number
  limit: number
  totalPages: number
  totalResults: number
}

export interface AlgorithmPresetQueryParams {
  sortBy?: string
  populate?: string
  limit?: number
  page?: number
  key?: string
  version?: string
}

export interface SnapshotQueryParams {
  sortBy?: string
  populate?: string
  limit?: number
  page?: number
  status?: "queued" | "running" | "completed" | "failed" | "cancelled"
  algorithmPreset?: string
  key?: string
  version?: string
}

export interface StorageMetadataDto {
  filename: string
  ext: string
  size: number
  contentType: string
  timestamp: number
}

export interface StorageDownloadResponseDto {
  url: string
  expiresIn: number
  metadata: StorageMetadataDto
}

export interface StorageVerifyResponseDto {
  key: string
  metadata: StorageMetadataDto
}

export type AdminRole = "owner" | "admin"
export type OAuthProviderId = "deep-id"
export const OAUTH_PROVIDER_IDS: readonly OAuthProviderId[] = ["deep-id"]

export type AdminAllowlistStatus = "active" | "revoked" | "all"
export type AdminListSortField = "email" | "invitedAt" | "revokedAt" | "role"
export type SortOrder = "asc" | "desc"

export interface AdminViewDto {
  provider: OAuthProviderId
  email: string
  role: AdminRole
  invitedAt: string
  invitedByEmail?: string
  revokedAt?: string
  revokedByEmail?: string
  lastSignInAt?: string
  activeSessionCount?: number
  hasEverSignedIn?: boolean
}

export interface AdminListResponseDto {
  results: AdminViewDto[]
  page: number
  limit: number
  totalResults: number
  totalPages: number
}

export interface ListAdminsQueryParams {
  provider?: OAuthProviderId
  role?: AdminRole
  status?: AdminAllowlistStatus
  q?: string
  sortField?: AdminListSortField
  sortOrder?: SortOrder
  page?: number
  limit?: number
  includeSessions?: boolean
}

export interface CreateAdminDto {
  provider: OAuthProviderId
  email: string
  role?: AdminRole
}

export interface UpdateAdminRoleDto {
  role: AdminRole
}

export type CommunityPlatform = "github" | "discord" | "mattermost"

export type CommunityConnectionStatus =
  | "pending"
  | "active"
  | "degraded"
  | "broken"
  | "disconnected"

/** Display facts from the last successful probe. Kept across later failed probes. */
export interface CommunityConnectionMetadataDto {
  avatarUrl?: string
  memberCount?: number
  resourceCount?: number
  /** Of the listed resources, the ones the pipeline can read under the bot's current access. */
  readableResourceCount?: number
}

export interface CommunityConnectionDto {
  id: string
  platform: CommunityPlatform
  externalId: string
  name: string
  status: CommunityConnectionStatus
  statusReason?: string
  /** When the platform last confirmed this state; checked on connect, on demand, per snapshot, and whenever the platform's live feed reports a change. */
  lastCheckedAt?: string
  metadata?: CommunityConnectionMetadataDto
  createdAt: string
  updatedAt: string
}

/** Why the pipeline cannot read a listed resource. */
export type CommunityResourceAccessIssue =
  | "missing_view_channel"
  | "missing_read_history"
  | "issues_disabled"
  | "not_member"

export interface CommunityResourceDto {
  id: string
  name: string
  kind: "text" | "announcement" | "forum" | "repository"
  /** Whether the pipeline can read this resource under the bot's current access. */
  readable: boolean
  /** Why the resource is unreadable; absent when it is readable. */
  accessIssue?: CommunityResourceAccessIssue
}

/**
 * State of a platform's live feed. `live` means the platform pushes its changes
 * (Discord Gateway, GitHub App webhooks, Mattermost WebSocket); anything else
 * means its changes are not arriving until the feed is back.
 */
export type CommunityFeedState = "live" | "connecting" | "down"

/** How changes are reaching an open events stream. */
export interface CommunityRealtimeStatusDto {
  feeds: Record<CommunityPlatform, CommunityFeedState>
}

/** Payloads of the `community/connections/events` SSE stream. */
export type CommunityConnectionEventDto =
  | { type: "community_connection:updated"; data: CommunityConnectionDto }
  | { type: "community_connection:removed"; data: { id: string } }
  | { type: "community_connection:watch"; data: CommunityRealtimeStatusDto }
  | { type: "community_connection:heartbeat"; data: { at: string } }

export interface CommunityHealthDto {
  status: CommunityConnectionStatus
  checkedAt: string
  reason?: string
}

export interface CommunityInstallUrlDto {
  url: string
}

export interface MattermostTeamDto {
  id: string
  name: string
  displayName: string
}

/** The token travels only in this request body and is never echoed back. */
export interface MattermostValidateRequestDto {
  serverUrl: string
  token: string
}

export interface MattermostValidationDto {
  teams: MattermostTeamDto[]
}

export interface MattermostConnectRequestDto
  extends MattermostValidateRequestDto {
  teamId: string
}

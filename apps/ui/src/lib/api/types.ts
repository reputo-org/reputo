// API Types generated from OpenAPI spec

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

export interface SnapshotResponseDto {
  _id: string
  status: "queued" | "running" | "completed" | "failed" | "cancelled"
  temporal?: TemporalResponseDto
  algorithmPreset: string
  algorithmPresetFrozen?: AlgorithmPresetFrozenDto
  outputs?: Record<string, unknown>
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

// Query parameters
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

// Admins
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

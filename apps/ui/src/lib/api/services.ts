import axios, { type AxiosError } from "axios"
import type {
  AdminListResponseDto,
  AdminViewDto,
  AlgorithmPresetQueryParams,
  AlgorithmPresetResponseDto,
  CommunityConnectionDto,
  CommunityHealthDto,
  CommunityInstallUrlDto,
  CommunityPlatform,
  CommunityResourceDto,
  CreateAdminDto,
  CreateAlgorithmPresetDto,
  CreateSnapshotDto,
  ListAdminsQueryParams,
  MattermostConnectRequestDto,
  MattermostValidateRequestDto,
  MattermostValidationDto,
  OAuthProviderId,
  PaginatedAlgorithmPresetResponseDto,
  PaginatedSnapshotResponseDto,
  SnapshotQueryParams,
  SnapshotResponseDto,
  StorageDownloadResponseDto,
  StorageVerifyResponseDto,
  UpdateAdminRoleDto,
  UpdateAlgorithmPresetDto,
} from "./types"

const API_BASE_PATH = "/api/v1"

let authFailureHandled = false
let sessionWasAuthenticated = false

/**
 * Record that the current browser session has observed an authenticated
 * `/me` response. Subsequent 401s after this flag is set are treated as a
 * mid-session revoke and routed to `/access-denied?reason=revoked` rather
 * than `/login`.
 */
export function markSessionAuthenticated(): void {
  sessionWasAuthenticated = true
}

/** Clear the "was authenticated" flag (call on logout). */
export function resetSessionAuthenticated(): void {
  sessionWasAuthenticated = false
  authFailureHandled = false
}

/**
 * Redirect on auth failure. Guarded so only one redirect fires.
 * - First-load 401 (no prior `/me` payload) → `/login`.
 * - Post-bootstrap 401 (admin removed mid-session) → `/access-denied?reason=revoked`.
 */
export function handleAuthFailure(): void {
  if (authFailureHandled) return
  authFailureHandled = true
  window.location.href = sessionWasAuthenticated
    ? "/access-denied?reason=revoked"
    : "/login"
}

const api = axios.create({
  baseURL: API_BASE_PATH,
  headers: {
    "Content-Type": "application/json",
  },
})

/** Axios interceptor — redirect to /login on any 401 response. */
function redirectToLoginOn401(error: AxiosError): Promise<never> {
  if (error.response?.status === 401) {
    handleAuthFailure()
  }
  return Promise.reject(error)
}

api.interceptors.response.use(undefined, redirectToLoginOn401)

export const algorithmPresetsApi = {
  getAll: async (
    params?: AlgorithmPresetQueryParams
  ): Promise<PaginatedAlgorithmPresetResponseDto> => {
    const response = await api.get("/algorithm-presets", { params })
    return response.data
  },

  getById: async (id: string): Promise<AlgorithmPresetResponseDto> => {
    const response = await api.get(`/algorithm-presets/${id}`)
    return response.data
  },

  create: async (
    data: CreateAlgorithmPresetDto
  ): Promise<AlgorithmPresetResponseDto> => {
    const response = await api.post("/algorithm-presets", data)
    return response.data
  },

  update: async (
    id: string,
    data: UpdateAlgorithmPresetDto
  ): Promise<AlgorithmPresetResponseDto> => {
    const response = await api.patch(`/algorithm-presets/${id}`, data)
    return response.data
  },

  delete: async (id: string): Promise<void> => {
    await api.delete(`/algorithm-presets/${id}`)
  },
}

export const snapshotsApi = {
  getAll: async (
    params?: SnapshotQueryParams
  ): Promise<PaginatedSnapshotResponseDto> => {
    const response = await api.get("/snapshots", { params })
    return response.data
  },

  getById: async (id: string): Promise<SnapshotResponseDto> => {
    const response = await api.get(`/snapshots/${id}`)
    return response.data
  },

  create: async (data: CreateSnapshotDto): Promise<SnapshotResponseDto> => {
    const response = await api.post("/snapshots", data)
    return response.data
  },

  delete: async (id: string): Promise<void> => {
    await api.delete(`/snapshots/${id}`)
  },

  subscribeToEvents: (params?: { algorithmPreset?: string }): EventSource => {
    const url = new URL(
      `${API_BASE_PATH}/snapshots/events`,
      window.location.href
    )
    if (params?.algorithmPreset) {
      url.searchParams.set("algorithmPreset", params.algorithmPreset)
    }
    return new EventSource(url.toString())
  },
}

export const storageApi = {
  createUpload: async (data: {
    filename: string
    contentType: string
  }): Promise<{ key: string; url: string; expiresIn: number }> => {
    const response = await api.post("/storage/uploads", data)
    return response.data
  },
  createDownload: async (data: {
    key: string
  }): Promise<StorageDownloadResponseDto> => {
    const response = await api.post("/storage/downloads", data)
    return response.data
  },
  verify: async (data: { key: string }): Promise<StorageVerifyResponseDto> => {
    const response = await api.post("/storage/uploads/verify", data)
    return response.data
  },
}

function adminPath(
  provider: OAuthProviderId,
  email: string,
  suffix = ""
): string {
  return `/admins/${encodeURIComponent(provider)}/${encodeURIComponent(email)}${suffix}`
}

export const adminsApi = {
  /** Paginated list with filters. Defaults to active rows sorted by email asc. */
  list: async (
    params: ListAdminsQueryParams = {}
  ): Promise<AdminListResponseDto> => {
    const response = await api.get<AdminListResponseDto>("/admins", { params })
    return response.data
  },
  /** Owner-only. Creates a new active row. 409 if any row exists for (provider, email). */
  add: async (data: CreateAdminDto): Promise<AdminViewDto> => {
    const response = await api.post<AdminViewDto>("/admins", data)
    return response.data
  },
  /** Owner-only. Promote/demote an active row. */
  updateRole: async (
    provider: OAuthProviderId,
    email: string,
    data: UpdateAdminRoleDto
  ): Promise<AdminViewDto> => {
    const response = await api.patch<AdminViewDto>(
      adminPath(provider, email),
      data
    )
    return response.data
  },
  /** Owner-only. Restore a previously revoked row as admin. */
  restore: async (
    provider: OAuthProviderId,
    email: string
  ): Promise<AdminViewDto> => {
    const response = await api.post<AdminViewDto>(
      adminPath(provider, email, "/restore")
    )
    return response.data
  },
  /** Owner-only. Soft-revoke and force logout for the matching user. */
  remove: async (provider: OAuthProviderId, email: string): Promise<void> => {
    await api.delete(adminPath(provider, email))
  },
}

export const communityApi = {
  /** Every connection with its lifecycle state. Credentials are never returned. */
  list: async (): Promise<CommunityConnectionDto[]> => {
    const response = await api.get<CommunityConnectionDto[]>(
      "/community/connections"
    )
    return response.data
  },
  /**
   * Platform install URL, carrying a signed state that expires. Pass a
   * connection id to reconnect it: where the platform allows it, the
   * authorization screen is then locked to that community so the admin cannot
   * land on a different one.
   */
  getInstallUrl: async (
    platform: CommunityPlatform,
    connectionId?: string
  ): Promise<CommunityInstallUrlDto> => {
    const response = await api.get<CommunityInstallUrlDto>(
      `/community/connections/${platform}/install-url`,
      { params: connectionId ? { connectionId } : undefined }
    )
    return response.data
  },
  listResources: async (id: string): Promise<CommunityResourceDto[]> => {
    const response = await api.get<CommunityResourceDto[]>(
      `/community/connections/${id}/resources`
    )
    return response.data
  },
  /** Runs the capability probe again and returns the resulting state. */
  recheck: async (id: string): Promise<CommunityHealthDto> => {
    const response = await api.get<CommunityHealthDto>(
      `/community/connections/${id}/health`
    )
    return response.data
  },
  /** Verifies a Mattermost URL + token and returns its teams. Stores nothing. */
  validateMattermost: async (
    payload: MattermostValidateRequestDto
  ): Promise<MattermostValidationDto> => {
    const response = await api.post<MattermostValidationDto>(
      "/community/connections/mattermost/validate",
      payload
    )
    return response.data
  },
  /** Connects a team; the API seals the token at rest and never returns it. */
  connectMattermost: async (
    payload: MattermostConnectRequestDto
  ): Promise<CommunityConnectionDto> => {
    const response = await api.post<CommunityConnectionDto>(
      "/community/connections/mattermost/connect",
      payload
    )
    return response.data
  },
  disconnect: async (id: string): Promise<void> => {
    await api.delete(`/community/connections/${id}`)
  },
  /**
   * Live connection changes, driven by each platform's own push transport. The
   * first event carries the feed status: which platforms are pushing right now.
   */
  subscribeToEvents: (): EventSource => {
    const url = new URL(
      `${API_BASE_PATH}/community/connections/events`,
      window.location.href
    )
    return new EventSource(url.toString())
  },
}

export { api }

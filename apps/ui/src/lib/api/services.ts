import axios, { type AxiosError } from "axios"
import type {
  AdminListResponseDto,
  AdminViewDto,
  AlgorithmPresetQueryParams,
  AlgorithmPresetResponseDto,
  CreateAdminDto,
  CreateAlgorithmPresetDto,
  CreateSnapshotDto,
  ListAdminsQueryParams,
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

// ── Centralised auth-failure handling ─────────────────────────────────

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

// Create axios instance with base configuration.
// Browser requests should always be same-origin (via Traefik / reverse-proxy).
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

// Algorithm Presets API
export const algorithmPresetsApi = {
  // Get all algorithm presets with pagination and filtering
  getAll: async (
    params?: AlgorithmPresetQueryParams
  ): Promise<PaginatedAlgorithmPresetResponseDto> => {
    const response = await api.get("/algorithm-presets", { params })
    return response.data
  },

  // Get a single algorithm preset by ID
  getById: async (id: string): Promise<AlgorithmPresetResponseDto> => {
    const response = await api.get(`/algorithm-presets/${id}`)
    return response.data
  },

  // Create a new algorithm preset
  create: async (
    data: CreateAlgorithmPresetDto
  ): Promise<AlgorithmPresetResponseDto> => {
    const response = await api.post("/algorithm-presets", data)
    return response.data
  },

  // Update an existing algorithm preset
  update: async (
    id: string,
    data: UpdateAlgorithmPresetDto
  ): Promise<AlgorithmPresetResponseDto> => {
    const response = await api.patch(`/algorithm-presets/${id}`, data)
    return response.data
  },

  // Delete an algorithm preset
  delete: async (id: string): Promise<void> => {
    await api.delete(`/algorithm-presets/${id}`)
  },
}

// Snapshots API
export const snapshotsApi = {
  // Get all snapshots with pagination and filtering
  getAll: async (
    params?: SnapshotQueryParams
  ): Promise<PaginatedSnapshotResponseDto> => {
    const response = await api.get("/snapshots", { params })
    return response.data
  },

  // Get a single snapshot by ID
  getById: async (id: string): Promise<SnapshotResponseDto> => {
    const response = await api.get(`/snapshots/${id}`)
    return response.data
  },

  // Create a new snapshot
  create: async (data: CreateSnapshotDto): Promise<SnapshotResponseDto> => {
    const response = await api.post("/snapshots", data)
    return response.data
  },

  // Delete a snapshot
  delete: async (id: string): Promise<void> => {
    await api.delete(`/snapshots/${id}`)
  },

  // Subscribe to snapshot events via SSE
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

// Storage API
export const storageApi = {
  // Create presigned upload URL
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
  // Verify upload and get metadata
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

// Admins API
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

export { api }

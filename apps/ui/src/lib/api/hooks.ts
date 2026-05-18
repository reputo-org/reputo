import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { adminsApi, algorithmPresetsApi, snapshotsApi } from "./services"
import type {
  AdminRole,
  AlgorithmPresetQueryParams,
  CreateAdminDto,
  CreateAlgorithmPresetDto,
  CreateSnapshotDto,
  ListAdminsQueryParams,
  OAuthProviderId,
  SnapshotQueryParams,
  UpdateAlgorithmPresetDto,
} from "./types"

// Query keys
export const queryKeys = {
  algorithmPresets: {
    all: ["algorithmPresets"] as const,
    lists: () => [...queryKeys.algorithmPresets.all, "list"] as const,
    list: (params?: AlgorithmPresetQueryParams) =>
      [...queryKeys.algorithmPresets.lists(), params] as const,
    details: () => [...queryKeys.algorithmPresets.all, "detail"] as const,
    detail: (id: string) =>
      [...queryKeys.algorithmPresets.details(), id] as const,
  },
  snapshots: {
    all: ["snapshots"] as const,
    lists: () => [...queryKeys.snapshots.all, "list"] as const,
    list: (params?: SnapshotQueryParams) =>
      [...queryKeys.snapshots.lists(), params] as const,
    details: () => [...queryKeys.snapshots.all, "detail"] as const,
    detail: (id: string) => [...queryKeys.snapshots.details(), id] as const,
  },
  admins: {
    all: ["admins"] as const,
    lists: () => [...queryKeys.admins.all, "list"] as const,
    list: (params?: ListAdminsQueryParams) =>
      [...queryKeys.admins.lists(), params ?? {}] as const,
  },
}

// Algorithm Presets hooks
export const useAlgorithmPresets = (params?: AlgorithmPresetQueryParams) => {
  return useQuery({
    queryKey: queryKeys.algorithmPresets.list(params),
    queryFn: () => algorithmPresetsApi.getAll(params),
  })
}

export const useAlgorithmPreset = (id: string) => {
  return useQuery({
    queryKey: queryKeys.algorithmPresets.detail(id),
    queryFn: () => algorithmPresetsApi.getById(id),
    enabled: !!id,
  })
}

export const useCreateAlgorithmPreset = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: CreateAlgorithmPresetDto) =>
      algorithmPresetsApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.algorithmPresets.lists(),
      })
    },
  })
}

export const useUpdateAlgorithmPreset = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string
      data: UpdateAlgorithmPresetDto
    }) => algorithmPresetsApi.update(id, data),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.algorithmPresets.lists(),
      })
      queryClient.invalidateQueries({
        queryKey: queryKeys.algorithmPresets.detail(id),
      })
    },
  })
}

export const useDeleteAlgorithmPreset = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => algorithmPresetsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.algorithmPresets.lists(),
      })
      // Deleting a preset cascade deletes its snapshots, so invalidate snapshots too
      queryClient.invalidateQueries({
        queryKey: queryKeys.snapshots.lists(),
      })
    },
  })
}

// Snapshots hooks
export const useSnapshots = (params?: SnapshotQueryParams) => {
  return useQuery({
    queryKey: queryKeys.snapshots.list(params),
    queryFn: () => snapshotsApi.getAll(params),
  })
}

export const useSnapshot = (id: string) => {
  return useQuery({
    queryKey: queryKeys.snapshots.detail(id),
    queryFn: () => snapshotsApi.getById(id),
    enabled: !!id,
  })
}

export const useCreateSnapshot = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: CreateSnapshotDto) => snapshotsApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.snapshots.lists() })
    },
  })
}

export const useDeleteSnapshot = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => snapshotsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.snapshots.lists() })
    },
  })
}

// Admins hooks
export const useAdmins = (params: ListAdminsQueryParams = {}) => {
  return useQuery({
    queryKey: queryKeys.admins.list(params),
    queryFn: () => adminsApi.list(params),
    placeholderData: (previous) => previous,
  })
}

const invalidateAdminLists = (queryClient: ReturnType<typeof useQueryClient>) =>
  queryClient.invalidateQueries({ queryKey: queryKeys.admins.lists() })

export const useAddAdmin = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: CreateAdminDto) => adminsApi.add(data),
    onSuccess: () => invalidateAdminLists(queryClient),
  })
}

export const useUpdateAdminRole = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      provider,
      email,
      role,
    }: {
      provider: OAuthProviderId
      email: string
      role: AdminRole
    }) => adminsApi.updateRole(provider, email, { role }),
    onSuccess: () => invalidateAdminLists(queryClient),
  })
}

export const useRestoreAdmin = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      provider,
      email,
    }: {
      provider: OAuthProviderId
      email: string
    }) => adminsApi.restore(provider, email),
    onSuccess: () => invalidateAdminLists(queryClient),
  })
}

export const useRemoveAdmin = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      provider,
      email,
    }: {
      provider: OAuthProviderId
      email: string
    }) => adminsApi.remove(provider, email),
    onSuccess: () => invalidateAdminLists(queryClient),
  })
}

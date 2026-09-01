import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  adminsApi,
  algorithmPresetsApi,
  communityApi,
  snapshotsApi,
} from "./services"
import type {
  AdminRole,
  AlgorithmPresetQueryParams,
  CreateAdminDto,
  CreateAlgorithmPresetDto,
  CreateSnapshotDto,
  ListAdminsQueryParams,
  MattermostConnectRequestDto,
  MattermostValidateRequestDto,
  OAuthProviderId,
  SnapshotQueryParams,
  UpdateAlgorithmPresetDto,
} from "./types"

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
  communityConnections: {
    all: ["communityConnections"] as const,
    lists: () => [...queryKeys.communityConnections.all, "list"] as const,
    resources: (id: string) =>
      [...queryKeys.communityConnections.all, "resources", id] as const,
  },
}

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
      queryClient.invalidateQueries({
        queryKey: queryKeys.snapshots.lists(),
      })
    },
  })
}

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

export const useCommunityConnections = () => {
  return useQuery({
    queryKey: queryKeys.communityConnections.lists(),
    queryFn: () => communityApi.list(),
  })
}

export const useCommunityResources = (id: string, enabled = true) => {
  return useQuery({
    queryKey: queryKeys.communityConnections.resources(id),
    queryFn: () => communityApi.listResources(id),
    enabled: Boolean(id) && enabled,
  })
}

const invalidateCommunityConnections = (
  queryClient: ReturnType<typeof useQueryClient>
) =>
  queryClient.invalidateQueries({
    queryKey: queryKeys.communityConnections.all,
  })

export const useRecheckCommunityConnection = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => communityApi.recheck(id),
    onSuccess: () => invalidateCommunityConnections(queryClient),
  })
}

/** Stateless server-side check; nothing to invalidate on success. */
export const useValidateMattermostConnection = () => {
  return useMutation({
    mutationFn: (payload: MattermostValidateRequestDto) =>
      communityApi.validateMattermost(payload),
  })
}

export const useConnectMattermostConnection = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (payload: MattermostConnectRequestDto) =>
      communityApi.connectMattermost(payload),
    // A failed probe still saves the connection in a broken state, so the
    // list refreshes on failure too.
    onSettled: () => invalidateCommunityConnections(queryClient),
  })
}

export const useDisconnectCommunityConnection = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => communityApi.disconnect(id),
    onSuccess: () => invalidateCommunityConnections(queryClient),
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

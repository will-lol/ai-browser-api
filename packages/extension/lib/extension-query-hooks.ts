import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import type { RuntimePermissionDecision } from "@llm-bridge/contracts"
import {
  cancelRuntimeProviderAuthFlow,
  currentOrigin,
  disconnectRuntimeProvider,
  fetchProviderAuthFlow,
  fetchModels,
  fetchOriginState,
  fetchPendingRequests,
  fetchPermissions,
  fetchProviders,
  openRuntimeProviderAuthWindow,
  startRuntimeProviderAuthFlow,
  setRuntimeOriginEnabled,
  resolveRuntimePermissionRequest,
  dismissRuntimePermissionRequest,
  updateRuntimeModelPermission,
} from "@/lib/extension-runtime-api"
import { extensionQueryKeys } from "@/lib/extension-query-keys"

type ProvidersData = Awaited<ReturnType<typeof fetchProviders>>
type PermissionsData = Awaited<ReturnType<typeof fetchPermissions>>
type PendingRequestsData = Awaited<ReturnType<typeof fetchPendingRequests>>

export function useProvidersQuery() {
  return useQuery({
    queryKey: extensionQueryKeys.providers(),
    queryFn: () => fetchProviders(),
  })
}

export function useProviderAuthFlowQuery(providerID: string) {
  return useQuery({
    queryKey: extensionQueryKeys.authFlow(providerID),
    queryFn: () => fetchProviderAuthFlow({ providerID }).then((response) => response.result),
    enabled: providerID.length > 0,
    refetchInterval: (query) => {
      const status = query.state.data?.status
      if (status === "authorizing") return 1_000
      return false
    },
  })
}

export function useModelsQuery(input?: {
  connectedOnly?: boolean
  providerID?: string
}) {
  return useQuery({
    queryKey: extensionQueryKeys.models({
      connectedOnly: input?.connectedOnly,
      providerID: input?.providerID,
    }),
    queryFn: () =>
      fetchModels({
        connectedOnly: input?.connectedOnly,
        providerID: input?.providerID,
      }),
  })
}

export function useOriginStateQuery(origin = currentOrigin()) {
  return useQuery({
    queryKey: extensionQueryKeys.originState(origin),
    queryFn: () => fetchOriginState(origin),
  })
}

export function usePermissionsQuery(origin = currentOrigin()) {
  return useQuery({
    queryKey: extensionQueryKeys.permissions(origin),
    queryFn: () => fetchPermissions(origin),
  })
}

export function usePendingRequestsQuery(origin = currentOrigin()) {
  return useQuery({
    queryKey: extensionQueryKeys.pendingRequests(origin),
    queryFn: () => fetchPendingRequests(origin),
  })
}

export function useProviderDisconnectMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ providerID }: { providerID: string }) =>
      disconnectRuntimeProvider({ providerID }),
    onSuccess: (_result, variables) => {
      const providerID = variables.providerID

      queryClient.setQueryData<ProvidersData>(
        extensionQueryKeys.providers(),
        (prev) =>
          prev?.map((provider) =>
            provider.id === providerID
              ? {
                  ...provider,
                  connected: false,
                }
              : provider,
          ) ?? prev,
      )

      queryClient.invalidateQueries({
        queryKey: extensionQueryKeys.modelsRoot,
      })
      queryClient.invalidateQueries({
        queryKey: extensionQueryKeys.providersRoot,
      })
      queryClient.invalidateQueries({
        queryKey: extensionQueryKeys.authFlow(providerID),
      })
    },
  })
}

export function useProviderOpenAuthWindowMutation() {
  return useMutation({
    mutationFn: ({ providerID }: { providerID: string }) =>
      openRuntimeProviderAuthWindow({ providerID }),
  })
}

export function useProviderStartAuthFlowMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      providerID,
      methodID,
      values,
    }: {
      providerID: string
      methodID: string
      values?: Record<string, string>
    }) => startRuntimeProviderAuthFlow({ providerID, methodID, values }),
    onSuccess: (response) => {
      queryClient.setQueryData(
        extensionQueryKeys.authFlow(response.providerID),
        response.result,
      )
    },
  })
}

export function useProviderCancelAuthFlowMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      providerID,
      reason,
    }: {
      providerID: string
      reason?: string
    }) => cancelRuntimeProviderAuthFlow({ providerID, reason }),
    onSuccess: (response) => {
      queryClient.setQueryData(
        extensionQueryKeys.authFlow(response.providerID),
        response.result,
      )
    },
  })
}

export function useOriginEnabledMutation(origin = currentOrigin()) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ enabled }: { enabled: boolean }) =>
      setRuntimeOriginEnabled({ enabled, origin }),
    onSuccess: (_result, variables) => {
      queryClient.setQueryData(extensionQueryKeys.originState(origin), {
        origin,
        enabled: variables.enabled,
      })
    },
  })
}

export function usePermissionUpdateMutation(origin = currentOrigin()) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      modelId,
      status,
    }: {
      modelId: string
      status: RuntimePermissionDecision
    }) => updateRuntimeModelPermission({ modelId, status, origin }),
    onSuccess: (_result, variables) => {
      queryClient.setQueryData<PermissionsData>(
        extensionQueryKeys.permissions(origin),
        (prev) =>
          prev?.map((permission) =>
            permission.modelId === variables.modelId
              ? {
                  ...permission,
                  status: variables.status,
                }
              : permission,
          ) ?? prev,
      )

      queryClient.invalidateQueries({
        queryKey: extensionQueryKeys.permissions(origin),
      })
    },
  })
}

export function usePermissionDecisionMutation(origin = currentOrigin()) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      requestId,
      decision,
    }: {
      requestId: string
      decision: RuntimePermissionDecision
    }) => resolveRuntimePermissionRequest({ requestId, decision }),
    onSuccess: (_result, variables) => {
      queryClient.setQueryData<PendingRequestsData>(
        extensionQueryKeys.pendingRequests(origin),
        (prev) =>
          prev?.filter((request) => request.id !== variables.requestId) ?? prev,
      )

      queryClient.invalidateQueries({
        queryKey: extensionQueryKeys.permissions(origin),
      })
    },
  })
}

export function usePermissionDismissMutation(origin = currentOrigin()) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ requestId }: { requestId: string }) =>
      dismissRuntimePermissionRequest({ requestId }),
    onSuccess: (_result, variables) => {
      queryClient.setQueryData<PendingRequestsData>(
        extensionQueryKeys.pendingRequests(origin),
        (prev) =>
          prev?.filter((request) => request.id !== variables.requestId) ?? prev,
      )

      queryClient.invalidateQueries({
        queryKey: extensionQueryKeys.permissions(origin),
      })
    },
  })
}

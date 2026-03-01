import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
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
import type { PermissionStatus } from "@/lib/runtime/permissions"

export function useProvidersQuery(origin = currentOrigin()) {
  return useQuery({
    queryKey: extensionQueryKeys.providers(),
    queryFn: () => fetchProviders(origin),
  })
}

export function useProviderAuthFlowQuery(
  providerID: string,
  origin = currentOrigin(),
) {
  return useQuery({
    queryKey: extensionQueryKeys.authFlow(providerID),
    queryFn: () => fetchProviderAuthFlow({ providerID, origin }).then((response) => response.result),
    enabled: providerID.length > 0,
    refetchInterval: (query) => {
      const status = query.state.data?.status
      if (status === "authorizing") return 1_000
      return false
    },
  })
}

export function useModelsQuery(input?: {
  origin?: string
  connectedOnly?: boolean
  providerID?: string
}) {
  const origin = input?.origin ?? currentOrigin()

  return useQuery({
    queryKey: extensionQueryKeys.models({
      connectedOnly: input?.connectedOnly,
      providerID: input?.providerID,
      origin,
    }),
    queryFn: () =>
      fetchModels({
        origin,
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

export function useProviderDisconnectMutation(origin = currentOrigin()) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ providerID }: { providerID: string }) =>
      disconnectRuntimeProvider({ providerID, origin }),
    onSuccess: (_result, variables) => {
      const providerID = variables.providerID

      queryClient.setQueryData(
        extensionQueryKeys.providers(),
        (
          prev:
            | Array<{
                id: string
                connected: boolean
              }>
            | undefined,
        ) => {
          if (!prev) return prev
          return prev.map((provider) =>
            provider.id === providerID
              ? {
                  ...provider,
                  connected: false,
                }
              : provider,
          )
        },
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

export function useProviderOpenAuthWindowMutation(origin = currentOrigin()) {
  return useMutation({
    mutationFn: ({ providerID }: { providerID: string }) =>
      openRuntimeProviderAuthWindow({ providerID, origin }),
  })
}

export function useProviderStartAuthFlowMutation(origin = currentOrigin()) {
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
    }) => startRuntimeProviderAuthFlow({ providerID, methodID, values, origin }),
    onSuccess: (response) => {
      queryClient.setQueryData(
        extensionQueryKeys.authFlow(response.providerID),
        response.result,
      )
    },
  })
}

export function useProviderCancelAuthFlowMutation(origin = currentOrigin()) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      providerID,
      reason,
    }: {
      providerID: string
      reason?: string
    }) => cancelRuntimeProviderAuthFlow({ providerID, reason, origin }),
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
      status: PermissionStatus
    }) => updateRuntimeModelPermission({ modelId, status, origin }),
    onSuccess: (_result, variables) => {
      queryClient.setQueryData(
        extensionQueryKeys.permissions(origin),
        (
          prev:
            | Array<{
                modelId: string
                modelName: string
                provider: string
                status: PermissionStatus
                capabilities: string[]
                requestedAt?: number
              }>
            | undefined,
        ) => {
          if (!prev) return prev
          return prev.map((permission) =>
            permission.modelId === variables.modelId
              ? {
                  ...permission,
                  status: variables.status,
                }
              : permission,
          )
        },
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
      decision: "allowed" | "denied"
    }) => resolveRuntimePermissionRequest({ requestId, decision, origin }),
    onSuccess: (_result, variables) => {
      queryClient.setQueryData(
        extensionQueryKeys.pendingRequests(origin),
        (
          prev:
            | Array<{
                id: string
              }>
            | undefined,
        ) => {
          if (!prev) return prev
          return prev.filter((request) => request.id !== variables.requestId)
        },
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
      dismissRuntimePermissionRequest({ requestId, origin }),
    onSuccess: (_result, variables) => {
      queryClient.setQueryData(
        extensionQueryKeys.pendingRequests(origin),
        (
          prev:
            | Array<{
                id: string
              }>
            | undefined,
        ) => {
          if (!prev) return prev
          return prev.filter((request) => request.id !== variables.requestId)
        },
      )

      queryClient.invalidateQueries({
        queryKey: extensionQueryKeys.permissions(origin),
      })
    },
  })
}

import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import {
  currentOrigin,
  disconnectRuntimeProvider,
  finishRuntimeProviderAuth,
  fetchProviderAuthMethods,
  fetchModels,
  fetchOriginState,
  fetchPendingRequests,
  fetchPermissions,
  fetchProviders,
  startRuntimeProviderAuth,
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

export function useProviderAuthMethodsQuery(
  providerID: string,
  origin = currentOrigin(),
) {
  return useQuery({
    queryKey: extensionQueryKeys.authMethods(providerID),
    queryFn: () => fetchProviderAuthMethods(providerID, origin),
    enabled: providerID.length > 0,
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
        queryKey: extensionQueryKeys.authMethods(providerID),
      })
    },
  })
}

export function useProviderStartAuthMutation(origin = currentOrigin()) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      providerID,
      methodIndex,
      values,
    }: {
      providerID: string
      methodIndex: number
      values?: Record<string, string>
    }) => startRuntimeProviderAuth({ providerID, methodIndex, values, origin }),
    onSuccess: (response, variables) => {
      if (!response.result.connected) return

      queryClient.invalidateQueries({
        queryKey: extensionQueryKeys.authMethods(variables.providerID),
      })

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
            provider.id === variables.providerID
              ? {
                  ...provider,
                  connected: true,
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
    },
  })
}

export function useProviderFinishAuthMutation(origin = currentOrigin()) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      providerID,
      methodIndex,
      code,
      callbackUrl,
    }: {
      providerID: string
      methodIndex: number
      code?: string
      callbackUrl?: string
    }) => finishRuntimeProviderAuth({ providerID, methodIndex, code, callbackUrl, origin }),
    onSuccess: (response, variables) => {
      if (!response.result.connected) return

      queryClient.invalidateQueries({
        queryKey: extensionQueryKeys.authMethods(variables.providerID),
      })

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
            provider.id === variables.providerID
              ? {
                  ...provider,
                  connected: true,
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

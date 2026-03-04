import { useEffect, useState, type ReactNode } from "react"
import {
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query"
import { browser } from "wxt/browser"
import { extensionQueryKeys } from "@/lib/extension-query-keys"
import { RUNTIME_STATE_KEY } from "@/lib/runtime/constants"
import { subscribeRuntimeEvents } from "@/lib/runtime/events/runtime-events"

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 0,
        gcTime: 0,
        retry: false,
        refetchOnMount: "always",
        refetchOnWindowFocus: "always",
        refetchOnReconnect: "always",
      },
      mutations: {
        retry: false,
      },
    },
  })
}

export function ExtensionQueryProvider({
  children,
}: {
  children: ReactNode
}) {
  const [queryClient] = useState(createQueryClient)

  useEffect(() => {
    const unsubscribeRuntimeEvents = subscribeRuntimeEvents((event) => {
      if (event.type === "runtime.providers.changed") {
        queryClient.invalidateQueries({
          queryKey: extensionQueryKeys.providersRoot,
        })
        queryClient.invalidateQueries({
          queryKey: extensionQueryKeys.modelsRoot,
        })
        return
      }

      if (event.type === "runtime.models.changed") {
        queryClient.invalidateQueries({
          queryKey: extensionQueryKeys.modelsRoot,
        })
        return
      }

      if (event.type === "runtime.auth.changed") {
        queryClient.invalidateQueries({
          queryKey: extensionQueryKeys.providersRoot,
        })
        queryClient.invalidateQueries({
          queryKey: extensionQueryKeys.authFlow(event.payload.providerID),
        })
        return
      }

      if (event.type === "runtime.authFlow.changed") {
        queryClient.invalidateQueries({
          queryKey: extensionQueryKeys.authFlow(event.payload.providerID),
        })
        return
      }

      if (event.type === "runtime.origin.changed") {
        queryClient.invalidateQueries({
          queryKey: extensionQueryKeys.originState(event.payload.origin),
        })
        return
      }

      if (event.type === "runtime.permissions.changed") {
        queryClient.invalidateQueries({
          queryKey: extensionQueryKeys.permissions(event.payload.origin),
        })
        return
      }

      if (event.type === "runtime.pending.changed") {
        queryClient.invalidateQueries({
          queryKey: extensionQueryKeys.pendingRequests(event.payload.origin),
        })
        return
      }

      if (event.type === "runtime.catalog.refreshed") {
        queryClient.invalidateQueries({
          queryKey: extensionQueryKeys.providersRoot,
        })
        queryClient.invalidateQueries({
          queryKey: extensionQueryKeys.modelsRoot,
        })
      }
    })

    const storageListener: Parameters<
      typeof browser.storage.onChanged.addListener
    >[0] = (changes, area) => {
      if (area !== "local") return
      if (!changes[RUNTIME_STATE_KEY]) return

      queryClient.invalidateQueries({
        queryKey: extensionQueryKeys.providersRoot,
      })
      queryClient.invalidateQueries({
        queryKey: extensionQueryKeys.modelsRoot,
      })
      queryClient.invalidateQueries({
        queryKey: extensionQueryKeys.originStateRoot,
      })
      queryClient.invalidateQueries({
        queryKey: extensionQueryKeys.permissionsRoot,
      })
      queryClient.invalidateQueries({
        queryKey: extensionQueryKeys.pendingRequestsRoot,
      })
    }

    browser.storage.onChanged.addListener(storageListener)

    return () => {
      unsubscribeRuntimeEvents()
      browser.storage.onChanged.removeListener(storageListener)
    }
  }, [queryClient])

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

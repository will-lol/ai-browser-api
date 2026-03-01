import { useEffect, useState, type ReactNode } from "react"
import {
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query"
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client"
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister"
import { browser } from "wxt/browser"
import { storage } from "wxt/utils/storage"
import { extensionQueryKeys } from "@/lib/extension-query-keys"
import { RUNTIME_STATE_KEY } from "@/lib/runtime/constants"
import { subscribeRuntimeEvents } from "@/lib/runtime/events/runtime-events"

const QUERY_STALE_TIME_MS = 30 * 1000
const QUERY_GC_TIME_MS = 24 * 60 * 60 * 1000
const QUERY_PERSIST_MAX_AGE_MS = 24 * 60 * 60 * 1000
const QUERY_PERSIST_KEY = "llm-bridge-popup-query-cache"
const QUERY_PERSIST_BUSTER = "llm-bridge-popup-query-cache-v2"

const popupQueryStorage = {
  getItem: async (key: string) =>
    (await storage.getItem<string>(`local:${key}`)) ?? null,
  setItem: async (key: string, value: string) => {
    await storage.setItem(`local:${key}`, value)
  },
  removeItem: async (key: string) => {
    await storage.removeItem(`local:${key}`)
  },
}

const popupQueryPersister = createAsyncStoragePersister({
  storage: popupQueryStorage,
  key: QUERY_PERSIST_KEY,
})

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: QUERY_STALE_TIME_MS,
        gcTime: QUERY_GC_TIME_MS,
        retry: false,
        refetchOnWindowFocus: false,
      },
      mutations: {
        retry: false,
      },
    },
  })
}

export function ExtensionQueryProvider({
  children,
  persist = false,
}: {
  children: ReactNode
  persist?: boolean
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

  if (persist) {
    return (
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={{
          persister: popupQueryPersister,
          maxAge: QUERY_PERSIST_MAX_AGE_MS,
          buster: QUERY_PERSIST_BUSTER,
          dehydrateOptions: {
            shouldDehydrateQuery: () => true,
          },
        }}
      >
        {children}
      </PersistQueryClientProvider>
    )
  }

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

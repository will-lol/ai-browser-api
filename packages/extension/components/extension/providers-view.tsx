import { useMemo, useState } from "react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Unplug, Plug } from "lucide-react"
import { SearchInput } from "@/components/extension/search-input"
import { useFrozenOrder } from "@/hooks/use-frozen-order"
import {
  useProviderDisconnectMutation,
  useProviderOpenAuthWindowMutation,
  useProvidersQuery,
} from "@/lib/extension-query-hooks"

export function ProvidersView() {
  const [search, setSearch] = useState("")
  const providersQuery = useProvidersQuery()
  const disconnectProviderMutation = useProviderDisconnectMutation()
  const openProviderAuthWindowMutation = useProviderOpenAuthWindowMutation()

  const providers = providersQuery.data ?? []

  const frozenOrder = useFrozenOrder(
    providers,
    (provider) => provider.id,
    (a, b) => {
      if (a.connected && !b.connected) return -1
      if (!a.connected && b.connected) return 1
      return a.name.localeCompare(b.name)
    },
  )

  const sorted = useMemo(() => {
    const providersById = new Map(
      providers.map((provider) => [provider.id, provider]),
    )
    const ordered = frozenOrder
      .map((id) => providersById.get(id))
      .filter(
        (provider): provider is NonNullable<typeof provider> => provider != null,
      )

    if (!search) return ordered

    const query = search.toLowerCase()
    return ordered.filter((provider) =>
      provider.name.toLowerCase().includes(query),
    )
  }, [frozenOrder, providers, search])

  if (providersQuery.isError) {
    return (
      <div className="flex flex-1 items-center justify-center px-6 py-10 text-center">
        <p className="text-xs text-destructive">
          Failed to load providers.
        </p>
      </div>
    )
  }

  if (providersQuery.isPending) {
    return (
      <div className="flex flex-1 items-center justify-center px-6 py-10 text-center">
        <p className="text-xs text-muted-foreground">Loading providers...</p>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <SearchInput
        ariaLabel="Search providers"
        placeholder="Search providers..."
        value={search}
        onChange={setSearch}
      />

      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col">
          {sorted.map((provider) => {
            const controlsDisabled =
              disconnectProviderMutation.isPending &&
              disconnectProviderMutation.variables?.providerID === provider.id
            const connectPending =
              openProviderAuthWindowMutation.isPending
              && openProviderAuthWindowMutation.variables?.providerID === provider.id

            return (
              <div
                key={provider.id}
                className={`group flex items-center gap-2 border-b border-border px-3 py-2 transition-colors hover:bg-secondary/50 ${
                  !provider.connected ? "opacity-50 hover:opacity-80" : ""
                }`}
              >
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-xs font-medium text-foreground">
                    {provider.name}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {provider.modelCount} models available
                  </span>
                </div>

                <button
                  onClick={() => {
                    if (provider.connected) {
                      disconnectProviderMutation.mutate({ providerID: provider.id })
                      return
                    }
                    openProviderAuthWindowMutation.mutate({ providerID: provider.id })
                  }}
                  disabled={controlsDisabled || connectPending}
                  className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-[10px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                    provider.connected
                      ? "text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      : "bg-primary text-primary-foreground hover:bg-primary/90"
                  }`}
                >
                  {provider.connected ? (
                    <>
                      <Unplug className="size-3" />
                      <span className="hidden group-hover:inline">Disconnect</span>
                      <span className="inline group-hover:hidden">Connected</span>
                    </>
                  ) : (
                    <>
                      <Plug className="size-3" />
                      {connectPending ? "Opening..." : "Connect"}
                    </>
                  )}
                </button>
              </div>
            )
          })}

          {sorted.length === 0 && search && (
            <div className="flex flex-col items-center gap-2 px-6 py-8 text-center">
              <p className="text-xs text-muted-foreground">
                No providers matching &ldquo;{search}&rdquo;
              </p>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}

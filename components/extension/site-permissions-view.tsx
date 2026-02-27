"use client"

import { useMemo, useState } from "react"
import { useExtension } from "@/lib/extension-store"
import { ModelRow } from "@/components/extension/model-row"
import { PendingRequestCard } from "@/components/extension/pending-request-card"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Switch } from "@/components/ui/switch"
import { Blocks } from "lucide-react"
import { SearchInput } from "@/components/extension/search-input"
import { useFrozenOrder } from "@/hooks/use-frozen-order"

interface SitePermissionsViewProps {
  onNavigateToProviders: () => void
}

export function SitePermissionsView({ onNavigateToProviders }: SitePermissionsViewProps) {
  const {
    getAllAvailableModels,
    getModelPermission,
    pendingRequests,
    originEnabled,
    setOriginEnabled,
  } = useExtension()
  const [search, setSearch] = useState("")

  const allModels = getAllAvailableModels()
  const pendingModelIds = useMemo(
    () => new Set(pendingRequests.map((r) => r.modelId)),
    [pendingRequests]
  )

  // Compute a frozen sort order ONCE on mount. The order stays stable while
  // the panel is open -- it naturally resets on reopen because the popup is
  // conditionally rendered and this component remounts.
  const frozenOrder = useFrozenOrder(
    allModels,
    (model) => model.modelId,
    (a, b) => {
      const aPending = pendingModelIds.has(a.modelId)
      const bPending = pendingModelIds.has(b.modelId)
      if (aPending && !bPending) return -1
      if (!aPending && bPending) return 1

      const aPermission = getModelPermission(a.modelId)
      const bPermission = getModelPermission(b.modelId)
      if (aPermission === "allowed" && bPermission !== "allowed") return -1
      if (aPermission !== "allowed" && bPermission === "allowed") return 1
      return a.modelName.localeCompare(b.modelName)
    }
  )

  // Build the display list: use frozen order, apply live search filter
  const sortedModels = useMemo(() => {
    const order = frozenOrder

    const modelsById = new Map(
      allModels.map((m) => [
        m.modelId,
        {
          ...m,
          permission: getModelPermission(m.modelId),
          isPending: pendingModelIds.has(m.modelId),
        },
      ])
    )

    // Preserve frozen order, just filter
    const ordered = order
      .map((id) => modelsById.get(id))
      .filter((m): m is NonNullable<typeof m> => m != null)

    // Pending requests are shown in their own section and should not be duplicated
    // in the All models list while the panel is open.
    const withoutPending = ordered.filter((m) => !m.isPending)

    if (!search) return withoutPending

    const q = search.toLowerCase()
    return withoutPending.filter(
      (m) =>
        m.modelName.toLowerCase().includes(q) ||
        m.provider.toLowerCase().includes(q)
    )
  }, [allModels, getModelPermission, pendingModelIds, frozenOrder, search])

  const hasConnectedProviders = allModels.length > 0

  if (!hasConnectedProviders) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-10">
        <div className="flex size-12 items-center justify-center rounded-xl bg-secondary text-muted-foreground">
          <Blocks className="size-6" />
        </div>
        <div className="flex flex-col items-center gap-1.5 text-center">
          <p className="text-sm font-medium text-foreground">No providers connected</p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Connect a model provider to start granting websites access to AI models.
          </p>
        </div>
        <button
          onClick={onNavigateToProviders}
          className="rounded-md bg-primary px-4 py-2 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Connect a provider
        </button>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <label
        htmlFor="origin-enabled-switch"
        className="flex cursor-pointer items-center justify-between border-b border-border px-3 py-1.5 font-sans transition-colors hover:bg-secondary/50"
      >
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Site enabled
        </span>
        <Switch
          id="origin-enabled-switch"
          checked={originEnabled}
          onCheckedChange={setOriginEnabled}
          aria-label="Enable extension on this site"
        />
      </label>

      <SearchInput
        ariaLabel="Search models"
        placeholder="Search models..."
        value={search}
        onChange={setSearch}
      />

      {/* Models list */}
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col">
          {/* Pending requests */}
          {pendingRequests.length > 0 && !search && (
            <div className="flex flex-col">
              <div className="sticky top-0 z-10 border-b border-border bg-background/95 px-3 py-1 backdrop-blur-sm">
                <span className="text-[10px] font-medium uppercase tracking-wider text-warning">
                  Pending requests
                </span>
              </div>
              {pendingRequests.map((req) => (
                <PendingRequestCard
                  key={req.id}
                  request={req}
                  variant="inline"
                  actionsDisabled={!originEnabled}
                />
              ))}
            </div>
          )}

          {/* Models */}
          {sortedModels.length > 0 ? (
            <div className="flex flex-col">
              {!search && pendingRequests.length > 0 && (
                <div className="sticky top-0 z-10 border-b border-border bg-background/95 px-3 py-1 backdrop-blur-sm">
                  <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    All models
                  </span>
                </div>
              )}
              {sortedModels.map((m) => (
                <ModelRow
                  key={m.modelId}
                  modelId={m.modelId}
                  modelName={m.modelName}
                  provider={m.provider}
                  capabilities={m.capabilities}
                  permission={m.permission}
                  disabled={!originEnabled}
                />
              ))}
            </div>
          ) : search ? (
            <div className="flex flex-col items-center gap-2 px-6 py-8 text-center">
              <p className="text-xs text-muted-foreground">
                No models matching &ldquo;{search}&rdquo;
              </p>
            </div>
          ) : null}
        </div>
      </ScrollArea>
    </div>
  )
}

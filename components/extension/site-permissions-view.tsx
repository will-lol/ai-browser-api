"use client"

import { useMemo, useState, useRef, useEffect } from "react"
import { useExtension } from "@/lib/extension-store"
import { ModelRow } from "@/components/extension/model-row"
import { PendingRequestCard } from "@/components/extension/pending-request-card"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Search, Blocks } from "lucide-react"

interface SitePermissionsViewProps {
  onNavigateToProviders: () => void
}

export function SitePermissionsView({ onNavigateToProviders }: SitePermissionsViewProps) {
  const { getAllAvailableModels, getModelPermission, pendingRequests } = useExtension()
  const [search, setSearch] = useState("")
  const searchRef = useRef<HTMLInputElement>(null)

  const allModels = getAllAvailableModels()

  // Dismissed pending requests for this origin
  const dismissedRequests = pendingRequests.filter((r) => r.dismissed)

  // Compute a frozen sort order ONCE on mount. The order stays stable while
  // the panel is open -- it naturally resets on reopen because the popup is
  // conditionally rendered and this component remounts.
  const frozenOrder = useRef<string[] | null>(null)
  if (frozenOrder.current === null) {
    const pendingModelIds = new Set(
      pendingRequests.filter((r) => r.dismissed).map((r) => r.modelId)
    )
    const snapshot = allModels.map((m) => ({
      modelId: m.modelId,
      modelName: m.modelName,
      permission: getModelPermission(m.modelId),
      isPending: pendingModelIds.has(m.modelId),
    }))

    snapshot.sort((a, b) => {
      // Pending first
      if (a.isPending && !b.isPending) return -1
      if (!a.isPending && b.isPending) return 1
      // Allowed before denied
      if (a.permission === "allowed" && b.permission !== "allowed") return -1
      if (a.permission !== "allowed" && b.permission === "allowed") return 1
      // Alphabetical within group
      return a.modelName.localeCompare(b.modelName)
    })

    frozenOrder.current = snapshot.map((m) => m.modelId)
  }

  // Build the display list: use frozen order, apply live search filter
  const sortedModels = useMemo(() => {
    const order = frozenOrder.current!
    const pendingModelIds = new Set(dismissedRequests.map((r) => r.modelId))

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

    if (!search) return ordered

    const q = search.toLowerCase()
    return ordered.filter(
      (m) =>
        m.modelName.toLowerCase().includes(q) ||
        m.provider.toLowerCase().includes(q)
    )
  }, [allModels, getModelPermission, dismissedRequests, search])

  const hasConnectedProviders = allModels.length > 0

  // Focus search on mount
  useEffect(() => {
    // Small delay to let the panel animate in
    const timer = setTimeout(() => {
      searchRef.current?.focus()
    }, 100)
    return () => clearTimeout(timer)
  }, [])

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
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Search */}
      <div className="border-b border-border px-3 py-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            ref={searchRef}
            type="text"
            placeholder="Search models..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 w-full rounded-md border border-border bg-secondary/50 pl-8 pr-3 text-xs text-foreground placeholder:text-muted-foreground outline-none transition-colors focus:border-ring focus:bg-secondary"
            aria-label="Search models"
          />
        </div>
      </div>

      {/* Models list */}
      <ScrollArea className="flex-1">
        <div className="flex flex-col">
          {/* Dismissed pending requests */}
          {dismissedRequests.length > 0 && !search && (
            <div className="flex flex-col">
              <div className="sticky top-0 z-10 border-b border-border bg-background/95 px-4 py-1.5 backdrop-blur-sm">
                <span className="text-[10px] font-medium uppercase tracking-wider text-warning">
                  Pending requests
                </span>
              </div>
              {dismissedRequests.map((req) => (
                <PendingRequestCard key={req.id} request={req} variant="inline" />
              ))}
            </div>
          )}

          {/* Models */}
          {sortedModels.length > 0 ? (
            <div className="flex flex-col">
              {!search && dismissedRequests.length > 0 && (
                <div className="sticky top-0 z-10 border-b border-border bg-background/95 px-4 py-1.5 backdrop-blur-sm">
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

"use client"

import { useMemo, useState, useRef, useEffect } from "react"
import { useExtension } from "@/lib/extension-store"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Search, Check, Unplug, Plug } from "lucide-react"

export function ProvidersView() {
  const { providers, toggleProvider } = useExtension()
  const [search, setSearch] = useState("")
  const searchRef = useRef<HTMLInputElement>(null)

  const sorted = useMemo(() => {
    const filtered = search
      ? providers.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()))
      : providers

    return filtered.sort((a, b) => {
      if (a.connected && !b.connected) return -1
      if (!a.connected && b.connected) return 1
      return a.name.localeCompare(b.name)
    })
  }, [providers, search])

  const connectedCount = providers.filter((p) => p.connected).length

  useEffect(() => {
    const timer = setTimeout(() => {
      searchRef.current?.focus()
    }, 100)
    return () => clearTimeout(timer)
  }, [])

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Search */}
      <div className="border-b border-border px-3 py-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            ref={searchRef}
            type="text"
            placeholder="Search providers..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 w-full rounded-md border border-border bg-secondary/50 pl-8 pr-3 text-xs text-foreground placeholder:text-muted-foreground outline-none transition-colors focus:border-ring focus:bg-secondary"
            aria-label="Search providers"
          />
        </div>
      </div>

      {/* Summary */}
      <div className="border-b border-border px-4 py-2">
        <span className="text-[10px] text-muted-foreground">
          {connectedCount} of {providers.length} providers connected
        </span>
      </div>

      {/* Providers list */}
      <ScrollArea className="flex-1">
        <div className="flex flex-col">
          {sorted.map((provider) => (
            <div
              key={provider.id}
              className={`group flex items-center gap-3 border-b border-border px-4 py-3 transition-colors hover:bg-secondary/50 ${
                !provider.connected ? "opacity-50 hover:opacity-80" : ""
              }`}
            >
              {/* Provider icon */}
              <div
                className={`flex size-8 shrink-0 items-center justify-center rounded-md text-[10px] font-bold ${
                  provider.connected
                    ? "bg-primary/10 text-primary"
                    : "bg-secondary text-muted-foreground"
                }`}
              >
                {provider.icon}
              </div>

              {/* Provider info */}
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex items-center gap-2">
                  <span className="truncate text-xs font-medium text-foreground">
                    {provider.name}
                  </span>
                  {provider.connected && (
                    <Check className="size-3 shrink-0 text-success" />
                  )}
                </div>
                <span className="text-[10px] text-muted-foreground">
                  {provider.models.length} models available
                </span>
              </div>

              {/* Connect / Disconnect */}
              <button
                onClick={() => toggleProvider(provider.id)}
                className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
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
                    Connect
                  </>
                )}
              </button>
            </div>
          ))}

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

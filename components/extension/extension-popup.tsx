"use client"

import { useState } from "react"
import { useExtension } from "@/lib/extension-store"
import { SitePermissionsView } from "@/components/extension/site-permissions-view"
import { ProvidersView } from "@/components/extension/providers-view"
import { Blocks, ArrowLeft } from "lucide-react"
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip"

export function ExtensionPopup() {
  const { currentOrigin } = useExtension()
  const [view, setView] = useState<"site" | "providers">("site")

  return (
    <div className="flex h-[600px] w-[400px] flex-col overflow-hidden rounded-lg border border-border bg-background">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        {view === "providers" ? (
          <button
            onClick={() => setView("site")}
            className="flex items-center justify-center rounded-md p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            aria-label="Back to site permissions"
          >
            <ArrowLeft className="size-4" />
          </button>
        ) : null}

        <div className="flex min-w-0 flex-1 flex-col">
          {view === "site" ? (
            <>
              <span className="truncate text-sm font-semibold text-foreground font-mono">
                {currentOrigin}
              </span>
              <span className="text-xs text-muted-foreground">Model permissions</span>
            </>
          ) : (
            <>
              <span className="text-sm font-semibold text-foreground">Providers</span>
              <span className="text-xs text-muted-foreground">Connect your AI accounts</span>
            </>
          )}
        </div>

        {view === "site" && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setView("providers")}
                className="flex items-center justify-center rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                aria-label="Manage providers"
              >
                <Blocks className="size-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Manage providers</TooltipContent>
          </Tooltip>
        )}
      </div>

      {/* Views */}
      {view === "site" ? (
        <SitePermissionsView onNavigateToProviders={() => setView("providers")} />
      ) : (
        <ProvidersView />
      )}
    </div>
  )
}

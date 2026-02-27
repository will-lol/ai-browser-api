"use client"

import { useState } from "react"
import { useExtension } from "@/lib/extension-store"
import { SitePermissionsView } from "@/components/extension/site-permissions-view"
import { ProvidersView } from "@/components/extension/providers-view"
import { Blocks, ArrowLeft } from "lucide-react"
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip"

export function ExtensionPopup() {
  const { currentOrigin } = useExtension()
  const [view, setView] = useState<"site" | "providers">("site")
  const showSiteView = view === "site"
  const showProvidersView = view === "providers"

  return (
    <div className="flex h-full w-full flex-col overflow-hidden rounded-none border border-border bg-background font-sans [&_*]:rounded-none">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
        {showProvidersView ? (
          <button
            onClick={() => setView("site")}
            className="flex items-center justify-center rounded-md p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            aria-label="Back to site permissions"
          >
            <ArrowLeft className="size-4" />
          </button>
        ) : null}

        <div className="flex min-w-0 flex-1 flex-col">
          {showSiteView ? (
            <>
              <span className="truncate text-[13px] font-semibold text-foreground font-mono">
                {currentOrigin}
              </span>
              <span className="text-[11px] text-muted-foreground">
                Model permissions
              </span>
            </>
          ) : (
            <span className="text-[13px] font-semibold text-foreground">
              Providers
            </span>
          )}
        </div>

        {showSiteView && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setView("providers")}
                className="flex items-center justify-center rounded-md p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                aria-label="Manage providers"
              >
                <Blocks className="size-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Manage providers</TooltipContent>
          </Tooltip>
        )}
      </div>

      {/* Views */}
      {showSiteView ? (
        <SitePermissionsView
          onNavigateToProviders={() => setView("providers")}
        />
      ) : (
        <ProvidersView />
      )}
    </div>
  )
}

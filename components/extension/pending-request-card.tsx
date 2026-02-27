"use client"

import { useExtension } from "@/lib/extension-store"
import { Badge } from "@/components/ui/badge"
import { Check, X as XIcon } from "lucide-react"
import type { PermissionRequest } from "@/lib/mock-data"
import { getProviderLabel } from "@/lib/provider-labels"

interface PendingRequestCardProps {
  request: PermissionRequest
  variant: "floating" | "inline"
  onClose?: () => void
  actionsDisabled?: boolean
}

function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000)
  if (seconds < 60) return "just now"
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ago`
}

export function PendingRequestCard({
  request,
  variant,
  onClose,
  actionsDisabled = false,
}: PendingRequestCardProps) {
  const { respondToRequest, dismissRequest } = useExtension()

  if (variant === "floating") {
    return (
      <div className="w-[304px] max-w-[calc(100vw-32px)] overflow-hidden rounded-none border border-border bg-card font-sans shadow-[0_10px_24px_rgba(0,0,0,0.24)] [&_*]:rounded-none">
        <div className="flex flex-col gap-2 p-2.5">
          {/* Origin + dismiss */}
          <div className="flex flex-col gap-0.5">
            <div className="flex items-start justify-between">
              <span className="text-[9px] text-muted-foreground">
                {request.origin} wants access to
              </span>
              <button
                onClick={() => {
                  dismissRequest(request.id)
                  onClose?.()
                }}
                className="-mr-0.5 -mt-0.5 flex items-center justify-center rounded p-0.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                aria-label="Dismiss"
              >
                <XIcon className="size-3" />
              </button>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[13px] font-semibold leading-none text-foreground font-mono">
                {request.modelName}
              </span>
              <Badge variant="outline" className="h-4 px-1.5 text-[9px] font-normal text-muted-foreground border-border">
                {getProviderLabel(request.provider)}
              </Badge>
            </div>
          </div>

          <div className="text-[10px] leading-4 text-muted-foreground">
            Open the extension popup to allow or deny this request.
          </div>
        </div>
      </div>
    )
  }

  // Inline variant for the extension popup
  return (
    <div className="flex items-center gap-2.5 border-b border-border bg-warning/5 px-3 py-2 font-sans">
      <div className="size-1.5 shrink-0 rounded-full bg-warning animate-pulse" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-xs font-medium text-foreground font-mono">
          {request.modelName}
        </span>
        <span className="text-[10px] text-muted-foreground">
          {getProviderLabel(request.provider)} &middot; {timeAgo(request.requestedAt)}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <button
          onClick={() => respondToRequest(request.id, "allowed")}
          disabled={actionsDisabled}
          className="flex items-center justify-center rounded p-1 text-muted-foreground transition-colors hover:bg-success/10 hover:text-success disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
          aria-label={`Allow ${request.modelName}`}
        >
          <Check className="size-3.5" />
        </button>
        <button
          onClick={() => respondToRequest(request.id, "denied")}
          disabled={actionsDisabled}
          className="flex items-center justify-center rounded p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
          aria-label={`Deny ${request.modelName}`}
        >
          <XIcon className="size-3.5" />
        </button>
      </div>
    </div>
  )
}

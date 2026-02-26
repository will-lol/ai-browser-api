"use client"

import { useExtension } from "@/lib/extension-store"
import { Badge } from "@/components/ui/badge"
import { Check, X as XIcon } from "lucide-react"
import type { PermissionRequest } from "@/lib/mock-data"

interface PendingRequestCardProps {
  request: PermissionRequest
  variant: "floating" | "inline"
  onClose?: () => void
}

const PROVIDER_LABELS: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google AI",
  mistral: "Mistral",
  meta: "Meta",
  cohere: "Cohere",
  xai: "xAI",
  deepseek: "DeepSeek",
  perplexity: "Perplexity",
}

function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000)
  if (seconds < 60) return "just now"
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ago`
}

export function PendingRequestCard({ request, variant, onClose }: PendingRequestCardProps) {
  const { respondToRequest, dismissRequest } = useExtension()

  if (variant === "floating") {
    return (
      <div className="w-[340px] overflow-hidden rounded-lg border border-border bg-card shadow-2xl shadow-background/80">
        <div className="flex flex-col gap-3 p-3">
          {/* Origin + dismiss */}
          <div className="flex flex-col gap-1">
            <div className="flex items-start justify-between">
              <span className="text-[10px] text-muted-foreground">
                {request.origin} wants access to
              </span>
              <button
                onClick={() => {
                  dismissRequest(request.id)
                  onClose?.()
                }}
                className="-mr-1 -mt-1 flex items-center justify-center rounded p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                aria-label="Dismiss"
              >
                <XIcon className="size-3.5" />
              </button>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-foreground font-mono">
                {request.modelName}
              </span>
              <Badge variant="outline" className="h-4 text-[10px] font-normal text-muted-foreground border-border">
                {PROVIDER_LABELS[request.provider] ?? request.provider}
              </Badge>
            </div>
          </div>

          {/* Capabilities */}
          <div className="flex flex-wrap gap-1">
            {request.capabilities.map((cap) => (
              <Badge
                key={cap}
                variant="secondary"
                className="h-5 text-[10px] font-normal text-secondary-foreground bg-secondary"
              >
                {cap}
              </Badge>
            ))}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                respondToRequest(request.id, "allowed")
                onClose?.()
              }}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <Check className="size-3.5" />
              Allow
            </button>
            <button
              onClick={() => {
                respondToRequest(request.id, "denied")
                onClose?.()
              }}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-border bg-secondary px-3 py-2 text-xs font-medium text-secondary-foreground transition-colors hover:bg-secondary/80"
            >
              <XIcon className="size-3.5" />
              Deny
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Inline variant for the extension popup
  return (
    <div className="flex items-center gap-3 border-b border-border bg-warning/5 px-4 py-2.5">
      <div className="size-1.5 shrink-0 rounded-full bg-warning animate-pulse" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-xs font-medium text-foreground font-mono">
          {request.modelName}
        </span>
        <span className="text-[10px] text-muted-foreground">
          {PROVIDER_LABELS[request.provider] ?? request.provider} &middot; {timeAgo(request.requestedAt)}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <button
          onClick={() => respondToRequest(request.id, "allowed")}
          className="flex items-center justify-center rounded p-1 text-muted-foreground transition-colors hover:bg-success/10 hover:text-success"
          aria-label={`Allow ${request.modelName}`}
        >
          <Check className="size-3.5" />
        </button>
        <button
          onClick={() => respondToRequest(request.id, "denied")}
          className="flex items-center justify-center rounded p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
          aria-label={`Deny ${request.modelName}`}
        >
          <XIcon className="size-3.5" />
        </button>
      </div>
    </div>
  )
}

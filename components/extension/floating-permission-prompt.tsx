"use client"

import { useState } from "react"
import { useExtension } from "@/lib/extension-store"
import { PendingRequestCard } from "@/components/extension/pending-request-card"
import { cn } from "@/lib/utils"

interface FloatingPermissionPromptProps {
  className?: string
  containerMode?: "fixed" | "embedded"
}

export function FloatingPermissionPrompt({
  className,
  containerMode = "fixed",
}: FloatingPermissionPromptProps = {}) {
  const { pendingRequests } = useExtension()
  const [closedIds, setClosedIds] = useState<Set<string>>(new Set())

  // Only show non-dismissed, non-closed floating requests
  const visibleRequests = pendingRequests.filter(
    (r) => !r.dismissed && !closedIds.has(r.id)
  )

  if (visibleRequests.length === 0) return null

  return (
    <div
      className={cn(
        "flex flex-col gap-2 font-sans",
        containerMode === "fixed" && "fixed right-6 top-6 z-50",
        containerMode === "embedded" && "relative",
        className
      )}
    >
      {visibleRequests.map((request) => (
        <div
          key={request.id}
          className="animate-in slide-in-from-top-2 fade-in duration-300"
        >
          <PendingRequestCard
            request={request}
            variant="floating"
            onClose={() => setClosedIds((prev) => new Set(prev).add(request.id))}
          />
        </div>
      ))}
    </div>
  )
}

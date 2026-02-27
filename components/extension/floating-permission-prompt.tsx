"use client"

import { useEffect, useMemo, useRef } from "react"
import { useExtension } from "@/lib/extension-store"
import { PendingRequestCard } from "@/components/extension/pending-request-card"
import { Toaster, toast } from "sonner"

interface FloatingPermissionPromptProps {
  className?: string
  containerMode?: "fixed" | "embedded"
}

export function FloatingPermissionPrompt({
  className,
  containerMode = "fixed",
}: FloatingPermissionPromptProps = {}) {
  const { pendingRequests, dismissRequest, originEnabled } = useExtension()
  const openToastIdsRef = useRef<Set<string>>(new Set())

  // In-window notifications are only shown for unresolved, non-dismissed requests.
  const visibleRequests = useMemo(
    () =>
      originEnabled
        ? pendingRequests.filter((request) => !request.dismissed)
        : [],
    [originEnabled, pendingRequests]
  )

  useEffect(() => {
    const visibleIds = new Set(visibleRequests.map((request) => request.id))

    // Show new notifications.
    for (const request of visibleRequests) {
      if (openToastIdsRef.current.has(request.id)) continue
      openToastIdsRef.current.add(request.id)
      toast.custom(
        () => (
          <PendingRequestCard
            request={request}
            variant="floating"
            onClose={() => {
              dismissRequest(request.id)
              toast.dismiss(request.id)
            }}
          />
        ),
        {
          id: request.id,
          unstyled: true,
          onDismiss: () => dismissRequest(request.id),
          onAutoClose: () => dismissRequest(request.id),
        }
      )
    }

    // Remove notifications no longer visible (resolved or dismissed).
    for (const toastId of Array.from(openToastIdsRef.current)) {
      if (visibleIds.has(toastId)) continue
      toast.dismiss(toastId)
      openToastIdsRef.current.delete(toastId)
    }
  }, [dismissRequest, visibleRequests])

  useEffect(() => {
    return () => {
      for (const toastId of Array.from(openToastIdsRef.current)) {
        toast.dismiss(toastId)
      }
      openToastIdsRef.current.clear()
    }
  }, [])

  return (
    <Toaster
      position="top-right"
      className={className}
      expand={false}
      gap={8}
      visibleToasts={5}
      offset={containerMode === "embedded" ? "0px" : "24px"}
      closeButton={false}
      toastOptions={{
        duration: 10000,
        unstyled: true,
      }}
    />
  )
}

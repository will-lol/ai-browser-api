import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { PendingRequestCard } from "@/components/extension/pending-request-card"
import { Toaster, toast } from "sonner"
import { currentOrigin } from "@/lib/extension-runtime-api"
import {
  useOriginStateQuery,
  usePendingRequestsQuery,
} from "@/lib/extension-query-hooks"

interface FloatingPermissionPromptProps {
  className?: string
  containerMode?: "fixed" | "embedded"
}

export function FloatingPermissionPrompt({
  className,
  containerMode = "fixed",
}: FloatingPermissionPromptProps = {}) {
  const origin = currentOrigin()
  const originStateQuery = useOriginStateQuery(origin)
  const pendingQuery = usePendingRequestsQuery(origin)
  const openToastIdsRef = useRef<Set<string>>(new Set())
  const [softDismissedIds, setSoftDismissedIds] = useState<Set<string>>(
    () => new Set(),
  )

  const pendingRequests = pendingQuery.data ?? []
  const originEnabled = originStateQuery.data?.enabled ?? true

  useEffect(() => {
    const pendingIds = new Set(pendingRequests.map((request) => request.id))
    setSoftDismissedIds((prev) => {
      const next = new Set(Array.from(prev).filter((id) => pendingIds.has(id)))
      if (next.size === prev.size) return prev
      return next
    })
  }, [pendingRequests])

  const visibleRequests = useMemo(
    () =>
      originEnabled
        ? pendingRequests.filter(
            (request) => !request.dismissed && !softDismissedIds.has(request.id),
          )
        : [],
    [originEnabled, pendingRequests, softDismissedIds],
  )

  const softDismissRequest = useCallback((requestId: string) => {
    setSoftDismissedIds((prev) => {
      if (prev.has(requestId)) return prev
      const next = new Set(prev)
      next.add(requestId)
      return next
    })

    toast.dismiss(requestId)
  }, [])

  useEffect(() => {
    const visibleIds = new Set(visibleRequests.map((request) => request.id))

    for (const request of visibleRequests) {
      if (openToastIdsRef.current.has(request.id)) continue

      openToastIdsRef.current.add(request.id)
      toast.custom(
        () => (
          <PendingRequestCard
            request={request}
            origin={origin}
            variant="floating"
            onClose={() => {
              softDismissRequest(request.id)
            }}
            onDismissRequest={softDismissRequest}
          />
        ),
        {
          id: request.id,
          unstyled: true,
          onDismiss: () => {
            softDismissRequest(request.id)
          },
          onAutoClose: () => {
            softDismissRequest(request.id)
          },
        },
      )
    }

    for (const toastId of Array.from(openToastIdsRef.current)) {
      if (visibleIds.has(toastId)) continue
      toast.dismiss(toastId)
      openToastIdsRef.current.delete(toastId)
    }
  }, [origin, softDismissRequest, visibleRequests])

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

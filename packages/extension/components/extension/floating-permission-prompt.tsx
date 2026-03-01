import { useCallback, useEffect, useMemo, useRef } from "react"
import { PendingRequestCard } from "@/components/extension/pending-request-card"
import { Toaster, toast } from "sonner"
import { currentOrigin } from "@/lib/extension-runtime-api"
import {
  useOriginStateQuery,
  usePendingRequestsQuery,
  usePermissionDismissMutation,
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
  const dismissMutation = usePermissionDismissMutation(origin)
  const openToastIdsRef = useRef<Set<string>>(new Set())
  const handledDismissIdsRef = useRef<Set<string>>(new Set())

  const pendingRequests = pendingQuery.data ?? []
  const originEnabled = originStateQuery.data?.enabled ?? true

  const visibleRequests = useMemo(
    () =>
      originEnabled
        ? pendingRequests.filter((request) => !request.dismissed)
        : [],
    [originEnabled, pendingRequests],
  )

  const dismissRequestAndToast = useCallback(
    (requestId: string) => {
      if (handledDismissIdsRef.current.has(requestId)) return
      handledDismissIdsRef.current.add(requestId)

      dismissMutation.mutate(
        { requestId },
        {
          onSuccess: () => {
            toast.dismiss(requestId)
          },
          onError: () => {
            handledDismissIdsRef.current.delete(requestId)
          },
        },
      )
    },
    [dismissMutation],
  )

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
              dismissRequestAndToast(request.id)
            }}
            onDismissRequest={dismissRequestAndToast}
            isDismissPending={
              dismissMutation.isPending &&
              dismissMutation.variables?.requestId === request.id
            }
          />
        ),
        {
          id: request.id,
          unstyled: true,
          onDismiss: () => {
            dismissRequestAndToast(request.id)
          },
          onAutoClose: () => {
            dismissRequestAndToast(request.id)
          },
        },
      )
    }

    for (const toastId of Array.from(openToastIdsRef.current)) {
      if (visibleIds.has(toastId)) continue
      toast.dismiss(toastId)
      openToastIdsRef.current.delete(toastId)
      handledDismissIdsRef.current.delete(toastId)
    }
  }, [dismissMutation.isPending, dismissMutation.variables, dismissRequestAndToast, visibleRequests])

  useEffect(() => {
    return () => {
      for (const toastId of Array.from(openToastIdsRef.current)) {
        toast.dismiss(toastId)
      }
      openToastIdsRef.current.clear()
      handledDismissIdsRef.current.clear()
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

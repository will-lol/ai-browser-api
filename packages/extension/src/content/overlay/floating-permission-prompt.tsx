import { Result, useAtomValue } from "@effect-atom/atom-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PendingRequestCard } from "@/app/components/pending-request-card";
import { Toaster, toast } from "sonner";
import { currentOrigin } from "@/app/api/runtime-api";
import { floatingPermissionDataResultAtom } from "@/app/state/runtime-data";

interface FloatingPermissionPromptProps {
  className?: string;
  containerMode?: "fixed" | "embedded";
}

export function FloatingPermissionPrompt({
  className,
  containerMode = "fixed",
}: FloatingPermissionPromptProps = {}) {
  const origin = currentOrigin();
  const dataResult = useAtomValue(floatingPermissionDataResultAtom(origin));
  const openToastIdsRef = useRef<Set<string>>(new Set());
  const [softDismissedIds, setSoftDismissedIds] = useState<Set<string>>(
    () => new Set(),
  );

  const data = useMemo(
    () => Result.getOrElse(dataResult, () => null),
    [dataResult],
  );
  const pendingRequests = useMemo(() => data?.pendingRequests ?? [], [data]);
  const originEnabled = data?.originState.enabled ?? true;

  useEffect(() => {
    const pendingIds = new Set(pendingRequests.map((request) => request.id));
    setSoftDismissedIds((prev) => {
      const next = new Set(Array.from(prev).filter((id) => pendingIds.has(id)));
      if (next.size === prev.size) return prev;
      return next;
    });
  }, [pendingRequests]);

  const visibleRequests = useMemo(
    () =>
      originEnabled
        ? pendingRequests.filter(
            (request) =>
              !request.dismissed && !softDismissedIds.has(request.id),
          )
        : [],
    [originEnabled, pendingRequests, softDismissedIds],
  );

  const softDismissRequest = useCallback((requestId: string) => {
    setSoftDismissedIds((prev) => {
      if (prev.has(requestId)) return prev;
      const next = new Set(prev);
      next.add(requestId);
      return next;
    });

    toast.dismiss(requestId);
  }, []);

  useEffect(() => {
    const visibleIds = new Set(visibleRequests.map((request) => request.id));

    for (const request of visibleRequests) {
      if (openToastIdsRef.current.has(request.id)) continue;

      openToastIdsRef.current.add(request.id);
      toast.custom(
        () => (
          <PendingRequestCard
            request={request}
            origin={origin}
            variant="floating"
            onClose={() => {
              softDismissRequest(request.id);
            }}
            onDismissRequest={softDismissRequest}
          />
        ),
        {
          id: request.id,
          unstyled: true,
          onDismiss: () => {
            softDismissRequest(request.id);
          },
          onAutoClose: () => {
            softDismissRequest(request.id);
          },
        },
      );
    }

    for (const toastId of Array.from(openToastIdsRef.current)) {
      if (visibleIds.has(toastId)) continue;
      toast.dismiss(toastId);
      openToastIdsRef.current.delete(toastId);
    }
  }, [origin, softDismissRequest, visibleRequests]);

  useEffect(() => {
    const openToastIds = openToastIdsRef.current;

    return () => {
      for (const toastId of Array.from(openToastIds)) {
        toast.dismiss(toastId);
      }
      openToastIds.clear();
    };
  }, []);

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
  );
}

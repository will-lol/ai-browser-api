import { useAtomSet } from "@effect-atom/atom-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Check, X as XIcon } from "lucide-react";
import { useState } from "react";
import type { RuntimePendingRequest } from "@llm-bridge/contracts";
import { getProviderLabel } from "@/lib/provider-labels";
import { resolvePermissionDecisionAtom } from "@/lib/extension-runtime-mutations";

interface PendingRequestCardProps {
  request: RuntimePendingRequest;
  origin: string;
  variant: "floating" | "inline";
  onClose?: () => void;
  actionsDisabled?: boolean;
  onDismissRequest?: (requestId: string) => void;
}

function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

function FloatingPendingRequestCard({
  request,
  onClose,
  onDismissRequest,
  actionsDisabled = false,
}: {
  request: RuntimePendingRequest;
  onClose?: () => void;
  onDismissRequest?: (requestId: string) => void;
  actionsDisabled?: boolean;
}) {
  return (
    <div className="w-[304px] max-w-[calc(100vw-32px)] overflow-hidden rounded-none border border-border bg-card font-sans shadow-[0_10px_24px_rgba(0,0,0,0.24)] [&_*]:rounded-none">
      <div className="flex flex-col gap-2 p-2.5">
        <div className="flex flex-col gap-0.5">
          <div className="flex items-start justify-between">
            <span className="text-[9px] text-muted-foreground">
              {request.origin} wants access to
            </span>
            <Button
              onClick={() => {
                if (onDismissRequest) {
                  onDismissRequest(request.id);
                }
                onClose?.();
              }}
              disabled={actionsDisabled}
              variant="ghost"
              size="icon-sm"
              className="-mr-0.5 -mt-0.5 text-muted-foreground disabled:opacity-40"
              aria-label="Dismiss"
            >
              <XIcon className="size-3" />
            </Button>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-[13px] font-semibold leading-none text-foreground">
              {request.modelName}
            </span>
            <Badge
              variant="outline"
              className="h-4 border-border px-1.5 text-[9px] font-normal text-muted-foreground"
            >
              {getProviderLabel(request.provider)}
            </Badge>
          </div>
        </div>

        <div className="text-[10px] leading-4 text-muted-foreground">
          Open the extension popup to allow or deny this request.
        </div>
      </div>
    </div>
  );
}

function InlinePendingRequestCard({
  request,
  origin,
  actionsDisabled = false,
}: {
  request: RuntimePendingRequest;
  origin: string;
  actionsDisabled?: boolean;
}) {
  const [pending, setPending] = useState(false);
  const resolveDecision = useAtomSet(resolvePermissionDecisionAtom, {
    mode: "promise",
  });
  const controlsDisabled = actionsDisabled || pending;

  return (
    <div className="flex items-center gap-2.5 border-b border-border bg-warning/5 px-3 py-2 font-sans">
      <div className="size-1.5 shrink-0 animate-pulse rounded-full bg-warning" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate font-mono text-xs font-medium text-foreground">
          {request.modelName}
        </span>
        <span className="text-[10px] text-muted-foreground">
          {getProviderLabel(request.provider)} &middot;{" "}
          {timeAgo(request.requestedAt)}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button
          onClick={() => {
            setPending(true);
            void resolveDecision({
              requestId: request.id,
              decision: "allowed",
              origin,
            })
              .catch((error) => {
                console.error(
                  "[pending-request-card] failed to resolve permission",
                  error,
                );
              })
              .finally(() => {
                setPending(false);
              });
          }}
          disabled={controlsDisabled}
          variant="successGhost"
          size="icon"
          className="disabled:opacity-40"
          aria-label={`Allow ${request.modelName}`}
        >
          <Check className="size-3.5" />
        </Button>
        <Button
          onClick={() => {
            setPending(true);
            void resolveDecision({
              requestId: request.id,
              decision: "denied",
              origin,
            })
              .catch((error) => {
                console.error(
                  "[pending-request-card] failed to reject permission",
                  error,
                );
              })
              .finally(() => {
                setPending(false);
              });
          }}
          disabled={controlsDisabled}
          variant="destructiveGhost"
          size="icon"
          className="disabled:opacity-40"
          aria-label={`Deny ${request.modelName}`}
        >
          <XIcon className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}

export function PendingRequestCard({
  request,
  origin,
  variant,
  onClose,
  actionsDisabled = false,
  onDismissRequest,
}: PendingRequestCardProps) {
  if (variant === "floating") {
    return (
      <FloatingPendingRequestCard
        request={request}
        onClose={onClose}
        onDismissRequest={onDismissRequest}
        actionsDisabled={actionsDisabled}
      />
    );
  }

  return (
    <InlinePendingRequestCard
      request={request}
      origin={origin}
      actionsDisabled={actionsDisabled}
    />
  );
}

import { getRuntimeAdminRPC } from "@/app/rpc/runtime-rpc-client";
import {
  RuntimeValidationError,
  type RuntimePermissionDecision,
  type RuntimeResolvedAuthMethod,
} from "@llm-bridge/contracts";
import * as Stream from "effect/Stream";

export type PermissionDecision = RuntimePermissionDecision;
export type ExtensionAuthMethod = RuntimeResolvedAuthMethod;

export function currentOrigin() {
  if (
    typeof window === "undefined" ||
    typeof window.location?.origin !== "string" ||
    window.location.origin.length === 0
  ) {
    throw new RuntimeValidationError({
      message:
        "Extension runtime API requires a trusted browser window origin.",
    });
  }

  return window.location.origin;
}

export function streamProviders() {
  const runtime = getRuntimeAdminRPC();
  return runtime.streamProviders({});
}

export function streamModels(input?: {
  connectedOnly?: boolean;
  providerID?: string;
}) {
  const runtime = getRuntimeAdminRPC();
  return runtime.streamModels({
    connectedOnly: input?.connectedOnly,
    providerID: input?.providerID,
  });
}

export function streamOriginState(origin = currentOrigin()) {
  const runtime = getRuntimeAdminRPC();
  return runtime.streamOriginState({ origin });
}

export function streamPermissions(origin = currentOrigin()) {
  const runtime = getRuntimeAdminRPC();
  return runtime.streamPermissions({ origin });
}

export function streamPendingRequests(origin = currentOrigin()) {
  const runtime = getRuntimeAdminRPC();
  return runtime.streamPending({ origin });
}

export function openRuntimeProviderAuthWindow(input: { providerID: string }) {
  const runtime = getRuntimeAdminRPC();
  return runtime.openProviderAuthWindow({
    providerID: input.providerID,
  });
}

export function streamProviderAuthFlow(input: { providerID: string }) {
  const runtime = getRuntimeAdminRPC();
  return runtime
    .streamProviderAuthFlow({
      providerID: input.providerID,
    })
    .pipe(Stream.map((response) => response.result));
}

export function startRuntimeProviderAuthFlow(input: {
  providerID: string;
  methodID: string;
  values?: Record<string, string>;
}) {
  const runtime = getRuntimeAdminRPC();
  return runtime.startProviderAuthFlow({
    providerID: input.providerID,
    methodID: input.methodID,
    values: input.values,
  });
}

export function cancelRuntimeProviderAuthFlow(input: {
  providerID: string;
  reason?: string;
}) {
  const runtime = getRuntimeAdminRPC();
  return runtime.cancelProviderAuthFlow({
    providerID: input.providerID,
    reason: input.reason,
  });
}

export function disconnectRuntimeProvider(input: { providerID: string }) {
  const runtime = getRuntimeAdminRPC();
  return runtime.disconnectProvider({
    providerID: input.providerID,
  });
}

export function setRuntimeOriginEnabled(input: {
  enabled: boolean;
  origin?: string;
}) {
  const origin = input.origin ?? currentOrigin();
  const runtime = getRuntimeAdminRPC();

  return runtime.setOriginEnabled({ enabled: input.enabled, origin });
}

export function resolveRuntimePermissionRequest(input: {
  requestId: string;
  decision: PermissionDecision;
}) {
  const runtime = getRuntimeAdminRPC();

  return runtime.resolvePermissionRequest({
    requestId: input.requestId,
    decision: input.decision,
  });
}

export function updateRuntimeModelPermission(input: {
  modelId: string;
  status: RuntimePermissionDecision;
  origin?: string;
}) {
  const origin = input.origin ?? currentOrigin();
  const runtime = getRuntimeAdminRPC();

  return runtime.setModelPermission({
    origin,
    modelId: input.modelId,
    status: input.status,
  });
}

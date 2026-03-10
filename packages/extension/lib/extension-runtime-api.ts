import { getRuntimeAdminRPC } from "@/lib/runtime/rpc/runtime-admin-rpc-client";
import type {
  RuntimePermissionDecision,
  RuntimeProviderSummary,
  RuntimeAuthMethod,
} from "@llm-bridge/contracts";

export type ExtensionProvider = RuntimeProviderSummary;
export type PermissionDecision = RuntimePermissionDecision;
export type ExtensionAuthMethod = RuntimeAuthMethod;

export function currentOrigin() {
  if (typeof window === "undefined") return "https://chat.example.com";
  return window.location.origin;
}

export function fetchProviders() {
  const runtime = getRuntimeAdminRPC();
  return runtime.listProviders({});
}

export function fetchModels(input?: {
  connectedOnly?: boolean;
  providerID?: string;
}) {
  const runtime = getRuntimeAdminRPC();
  return runtime.listModels({
    connectedOnly: input?.connectedOnly,
    providerID: input?.providerID,
  });
}

export function fetchOriginState(origin = currentOrigin()) {
  const runtime = getRuntimeAdminRPC();
  return runtime.getOriginState({ origin });
}

export function fetchPermissions(origin = currentOrigin()) {
  const runtime = getRuntimeAdminRPC();
  return runtime.listPermissions({ origin });
}

export function fetchPendingRequests(origin = currentOrigin()) {
  const runtime = getRuntimeAdminRPC();
  return runtime.listPending({ origin });
}

export function openRuntimeProviderAuthWindow(input: { providerID: string }) {
  const runtime = getRuntimeAdminRPC();
  return runtime.openProviderAuthWindow({
    providerID: input.providerID,
  });
}

export function fetchProviderAuthFlow(input: { providerID: string }) {
  const runtime = getRuntimeAdminRPC();
  return runtime.getProviderAuthFlow({
    providerID: input.providerID,
  });
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

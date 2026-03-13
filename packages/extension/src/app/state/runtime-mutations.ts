import { createMutationResource } from "@llm-bridge/reactive-core";
import {
  cancelRuntimeProviderAuthFlow,
  disconnectRuntimeProvider,
  openRuntimeProviderAuthWindow,
  resolveRuntimePermissionRequest,
  setRuntimeOriginEnabled,
  startRuntimeProviderAuthFlow,
  updateRuntimeModelPermission,
  type PermissionDecision,
} from "@/app/api/runtime-api";
import { extensionReactiveRuntime } from "@/app/state/atom-runtime";

export const openProviderAuthWindowMutation = createMutationResource(
  extensionReactiveRuntime,
  {
    run: ({ providerID }: { providerID: string }) =>
      openRuntimeProviderAuthWindow({
        providerID,
      }),
  },
);

export const disconnectProviderMutation = createMutationResource(
  extensionReactiveRuntime,
  {
    run: ({ providerID }: { providerID: string }) =>
      disconnectRuntimeProvider({
        providerID,
      }),
  },
);

export const startProviderAuthFlowMutation = createMutationResource(
  extensionReactiveRuntime,
  {
    run: ({
      methodID,
      providerID,
      values,
    }: {
      providerID: string;
      methodID: string;
      values?: Record<string, string>;
    }) =>
      startRuntimeProviderAuthFlow({
        providerID,
        methodID,
        values,
      }),
  },
);

export const cancelProviderAuthFlowMutation = createMutationResource(
  extensionReactiveRuntime,
  {
    run: ({
      providerID,
      reason,
    }: {
      providerID: string;
      reason?: string;
    }) =>
      cancelRuntimeProviderAuthFlow({
        providerID,
        reason,
      }),
  },
);

export const setOriginEnabledMutation = createMutationResource(
  extensionReactiveRuntime,
  {
    run: ({
      enabled,
      origin,
    }: {
      enabled: boolean;
      origin: string;
    }) =>
      setRuntimeOriginEnabled({
        enabled,
        origin,
      }),
  },
);

export const updateModelPermissionMutation = createMutationResource(
  extensionReactiveRuntime,
  {
    run: ({
      modelId,
      origin,
      status,
    }: {
      modelId: string;
      origin: string;
      status: "allowed" | "denied";
    }) =>
      updateRuntimeModelPermission({
        modelId,
        origin,
        status,
      }),
  },
);

export const resolvePermissionDecisionMutation = createMutationResource(
  extensionReactiveRuntime,
  {
    run: ({
      decision,
      requestId,
    }: {
      requestId: string;
      decision: PermissionDecision;
      origin: string;
    }) =>
      resolveRuntimePermissionRequest({
        requestId,
        decision,
      }),
  },
);

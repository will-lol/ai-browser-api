import * as Reactivity from "@effect/experimental/Reactivity";
import * as Effect from "effect/Effect";
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
import { extensionAtomRuntime } from "@/app/state/atom-runtime";
import { runtimeReactivityKeys } from "@/app/state/runtime-reactivity";

const invalidateKeys = (keys: ReadonlyArray<string>) =>
  Reactivity.invalidate(keys);

export const openProviderAuthWindowAtom = extensionAtomRuntime.fn(
  Effect.fn(function* ({ providerID }: { providerID: string }) {
    return yield* openRuntimeProviderAuthWindow({
      providerID,
    });
  }),
);

export const disconnectProviderAtom = extensionAtomRuntime.fn(
  Effect.fn(function* ({ providerID }: { providerID: string }) {
    const result = yield* disconnectRuntimeProvider({
      providerID,
    });

    yield* invalidateKeys([
      runtimeReactivityKeys.providers,
      runtimeReactivityKeys.models,
      runtimeReactivityKeys.authFlow(providerID),
    ]);

    return result;
  }),
);

export const startProviderAuthFlowAtom = extensionAtomRuntime.fn(
  Effect.fn(function* ({
    methodID,
    providerID,
    values,
  }: {
    providerID: string;
    methodID: string;
    values?: Record<string, string>;
  }) {
    const result = yield* startRuntimeProviderAuthFlow({
      providerID,
      methodID,
      values,
    });

    yield* invalidateKeys([
      runtimeReactivityKeys.authFlow(providerID),
      runtimeReactivityKeys.providers,
      runtimeReactivityKeys.models,
    ]);

    return result;
  }),
);

export const cancelProviderAuthFlowAtom = extensionAtomRuntime.fn(
  Effect.fn(function* ({
    providerID,
    reason,
  }: {
    providerID: string;
    reason?: string;
  }) {
    const result = yield* cancelRuntimeProviderAuthFlow({
      providerID,
      reason,
    });

    yield* invalidateKeys([
      runtimeReactivityKeys.authFlow(providerID),
      runtimeReactivityKeys.providers,
      runtimeReactivityKeys.models,
    ]);

    return result;
  }),
);

export const setOriginEnabledAtom = extensionAtomRuntime.fn(
  Effect.fn(function* ({
    enabled,
    origin,
  }: {
    enabled: boolean;
    origin: string;
  }) {
    const result = yield* setRuntimeOriginEnabled({
      enabled,
      origin,
    });

    yield* invalidateKeys([
      runtimeReactivityKeys.origin(origin),
      runtimeReactivityKeys.permissions(origin),
      runtimeReactivityKeys.pending(origin),
    ]);

    return result;
  }),
);

export const updateModelPermissionAtom = extensionAtomRuntime.fn(
  Effect.fn(function* ({
    modelId,
    origin,
    status,
  }: {
    modelId: string;
    origin: string;
    status: "allowed" | "denied";
  }) {
    const result = yield* updateRuntimeModelPermission({
      modelId,
      origin,
      status,
    });

    yield* invalidateKeys([
      runtimeReactivityKeys.permissions(origin),
      runtimeReactivityKeys.pending(origin),
    ]);

    return result;
  }),
);

export const resolvePermissionDecisionAtom = extensionAtomRuntime.fn(
  Effect.fn(function* ({
    decision,
    origin,
    requestId,
  }: {
    requestId: string;
    decision: PermissionDecision;
    origin: string;
  }) {
    const result = yield* resolveRuntimePermissionRequest({
      requestId,
      decision,
    });

    yield* invalidateKeys([
      runtimeReactivityKeys.permissions(origin),
      runtimeReactivityKeys.pending(origin),
    ]);

    return result;
  }),
);

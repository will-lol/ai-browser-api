import type { RuntimeEvent } from "@llm-bridge/contracts";
import { createReactivityBridgeResource } from "@llm-bridge/reactive-core";
import { extensionReactiveRuntime } from "@/app/state/atom-runtime";
import { subscribeRuntimeEvents } from "@/app/events/runtime-events";

export const runtimeReactivityKeys = {
  providers: "providers",
  models: "models",
  catalog: "catalog",
  auth: "auth",
  authFlow: (providerID: string) => `authFlow:${providerID}`,
  origin: (origin: string) => `origin:${origin}`,
  permissions: (origin: string) => `permissions:${origin}`,
  pending: (origin: string) => `pending:${origin}`,
} as const;

function reactivityKeysForRuntimeEvent(
  event: RuntimeEvent,
): ReadonlyArray<string> {
  switch (event.type) {
    case "runtime.providers.changed":
      return [runtimeReactivityKeys.providers, runtimeReactivityKeys.models];
    case "runtime.models.changed":
      return [runtimeReactivityKeys.models];
    case "runtime.catalog.refreshed":
      return [
        runtimeReactivityKeys.catalog,
        runtimeReactivityKeys.providers,
        runtimeReactivityKeys.models,
      ];
    case "runtime.auth.changed":
      return [runtimeReactivityKeys.auth, runtimeReactivityKeys.providers];
    case "runtime.authFlow.changed":
      return [runtimeReactivityKeys.authFlow(event.payload.providerID)];
    case "runtime.origin.changed":
      return [runtimeReactivityKeys.origin(event.payload.origin)];
    case "runtime.permissions.changed":
      return [runtimeReactivityKeys.permissions(event.payload.origin)];
    case "runtime.pending.changed":
      return [runtimeReactivityKeys.pending(event.payload.origin)];
  }
}

export const runtimeEventReactivityBridgeResource = createReactivityBridgeResource(
  extensionReactiveRuntime,
  {
    subscribe: subscribeRuntimeEvents,
    keysForEvent: reactivityKeysForRuntimeEvent,
  },
);

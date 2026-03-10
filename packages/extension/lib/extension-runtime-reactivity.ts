import { Atom } from "@effect-atom/atom-react";
import * as Reactivity from "@effect/experimental/Reactivity";
import type { RuntimeEvent } from "@llm-bridge/contracts";
import * as Effect from "effect/Effect";
import * as Runtime from "effect/Runtime";
import { extensionAtomRuntime } from "@/lib/extension-atom-runtime";
import { subscribeRuntimeEvents } from "@/lib/runtime/events/runtime-events";

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

export const runtimeEventReactivityBridgeAtom = extensionAtomRuntime
  .atom(
    Effect.gen(function* () {
      const runtime = yield* Effect.runtime<Reactivity.Reactivity>();
      const runFork = Runtime.runFork(runtime);
      const unsubscribe = subscribeRuntimeEvents((event) => {
        const keys = reactivityKeysForRuntimeEvent(event);
        if (keys.length === 0) return;
        runFork(Reactivity.invalidate(keys));
      });

      yield* Effect.addFinalizer(() => Effect.sync(unsubscribe));
    }),
  )
  .pipe(Atom.keepAlive);

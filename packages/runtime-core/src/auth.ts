import type {
  RuntimeCancelProviderAuthFlowResponse,
  RuntimeDisconnectProviderResponse,
  RuntimeOpenProviderAuthWindowResponse,
  RuntimeStartProviderAuthFlowResponse,
} from "@llm-bridge/contracts";
import * as Effect from "effect/Effect";
import { RuntimeEnvironment, type AppEffect } from "./environment";

export function startup(): AppEffect<void> {
  return Effect.flatMap(RuntimeEnvironment, (env) => env.catalog.ensureCatalog());
}

export function openProviderAuthWindow(
  providerID: string,
): AppEffect<RuntimeOpenProviderAuthWindowResponse> {
  return Effect.flatMap(RuntimeEnvironment, (env) =>
    env.auth.openProviderAuthWindow(providerID),
  );
}

export function getProviderAuthFlow(providerID: string) {
  return Effect.flatMap(RuntimeEnvironment, (env) =>
    env.auth.getProviderAuthFlow(providerID),
  );
}

export function startProviderAuthFlow(input: {
  providerID: string;
  methodID: string;
  values?: Record<string, string>;
}): AppEffect<RuntimeStartProviderAuthFlowResponse> {
  return Effect.flatMap(RuntimeEnvironment, (env) =>
    env.auth.startProviderAuthFlow(input).pipe(
      Effect.tap(() => env.catalog.refreshCatalogForProvider(input.providerID)),
    ),
  );
}

export function cancelProviderAuthFlow(input: {
  providerID: string;
  reason?: string;
}): AppEffect<RuntimeCancelProviderAuthFlowResponse> {
  return Effect.flatMap(RuntimeEnvironment, (env) =>
    env.auth.cancelProviderAuthFlow(input),
  );
}

export function disconnectProvider(
  providerID: string,
): AppEffect<RuntimeDisconnectProviderResponse> {
  return Effect.flatMap(RuntimeEnvironment, (env) =>
    env.auth.disconnectProvider(providerID).pipe(
      Effect.tap(() => env.catalog.refreshCatalogForProvider(providerID)),
    ),
  );
}

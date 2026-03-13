import type {
  RuntimeCancelProviderAuthFlowResponse,
  RuntimeDisconnectProviderResponse,
  RuntimeOpenProviderAuthWindowResponse,
  RuntimeStartProviderAuthFlowResponse,
} from "@llm-bridge/contracts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { AuthFlowService, CatalogService, type AppEffect } from "./environment";

export function startup(): AppEffect<void> {
  return Effect.flatMap(CatalogService, (service) =>
    service.ensureCatalog(),
  );
}

export function openProviderAuthWindow(
  providerID: string,
): AppEffect<RuntimeOpenProviderAuthWindowResponse> {
  return Effect.flatMap(AuthFlowService, (service) =>
    service.openProviderAuthWindow(providerID),
  );
}

export function getProviderAuthFlow(providerID: string) {
  return Effect.flatMap(AuthFlowService, (service) =>
    service.getProviderAuthFlow(providerID),
  );
}

export function streamProviderAuthFlow(providerID: string) {
  return Stream.unwrap(
    Effect.map(AuthFlowService, (service) =>
      service.streamProviderAuthFlow(providerID),
    ),
  );
}

export function startProviderAuthFlow(input: {
  providerID: string;
  methodID: string;
  values?: Record<string, string>;
}): AppEffect<RuntimeStartProviderAuthFlowResponse> {
  return Effect.flatMap(AuthFlowService, (service) =>
    service.startProviderAuthFlow(input),
  );
}

export function cancelProviderAuthFlow(input: {
  providerID: string;
  reason?: string;
}): AppEffect<RuntimeCancelProviderAuthFlowResponse> {
  return Effect.flatMap(AuthFlowService, (service) =>
    service.cancelProviderAuthFlow(input),
  );
}

export function disconnectProvider(
  providerID: string,
): AppEffect<RuntimeDisconnectProviderResponse> {
  return Effect.flatMap(AuthFlowService, (service) =>
    service.disconnectProvider(providerID),
  );
}

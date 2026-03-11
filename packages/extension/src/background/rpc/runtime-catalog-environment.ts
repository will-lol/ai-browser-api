import * as Effect from "effect/Effect";
import type { RuntimeEnvironmentApi } from "@llm-bridge/runtime-core";
import {
  ensureProviderCatalog,
  refreshProviderCatalog,
  refreshProviderCatalogForProvider,
} from "@/background/runtime/catalog/provider-registry";

export function makeRuntimeCatalogEnvironment(): RuntimeEnvironmentApi["catalog"] {
  return {
    ensureCatalog: () => ensureProviderCatalog().pipe(Effect.asVoid),
    refreshCatalog: () => refreshProviderCatalog().pipe(Effect.asVoid),
    refreshCatalogForProvider: (providerID: string) =>
      refreshProviderCatalogForProvider(providerID).pipe(Effect.asVoid),
  };
}

import * as Effect from "effect/Effect";
import type { RuntimeEnvironmentApi } from "@llm-bridge/runtime-core";
import {
  ensureProviderCatalog,
  refreshProviderCatalog,
  refreshProviderCatalogForProvider,
} from "@/background/runtime/catalog/provider-registry";
import { tryExtensionPromise } from "@/background/rpc/runtime-environment-shared";

export function makeRuntimeCatalogEnvironment(): RuntimeEnvironmentApi["catalog"] {
  return {
    ensureCatalog: () =>
      tryExtensionPromise("catalog.ensure", () => ensureProviderCatalog()),
    refreshCatalog: () =>
      tryExtensionPromise("catalog.refresh", () =>
        refreshProviderCatalog(),
      ).pipe(Effect.asVoid),
    refreshCatalogForProvider: (providerID: string) =>
      tryExtensionPromise("catalog.refreshProvider", () =>
        refreshProviderCatalogForProvider(providerID),
      ),
  };
}

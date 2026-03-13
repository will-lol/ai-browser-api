import {
  CatalogService,
  type CatalogServiceApi,
} from "@llm-bridge/runtime-core";
import type {
  RuntimeModelSummary,
  RuntimeProviderSummary,
} from "@llm-bridge/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import {
  listModelRows,
  listProviderRows,
} from "@/background/runtime/catalog/provider-registry-query";
import {
  ensureProviderCatalog,
  refreshProviderCatalog,
  refreshProviderCatalogForProvider,
} from "@/background/runtime/catalog/provider-registry-refresh";
import type {
  RuntimeDbModel,
  RuntimeDbProvider,
} from "@/background/storage/runtime-db-types";

function summarizeProviders(
  rows: ReadonlyArray<RuntimeDbProvider>,
): ReadonlyArray<RuntimeProviderSummary> {
  return rows
    .map((row) => ({
      id: row.id,
      name: row.name,
      connected: row.connected,
      env: row.env,
      modelCount: row.modelCount,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function summarizeModels(
  rows: ReadonlyArray<RuntimeDbModel>,
  connectedProviders: ReadonlySet<string>,
): ReadonlyArray<RuntimeModelSummary> {
  return rows
    .map((row) => ({
      id: row.id,
      name: row.info.name,
      provider: row.providerID,
      capabilities: row.capabilities,
      connected: connectedProviders.has(row.providerID),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function sameSnapshot<A>(left: A, right: A) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function filterModels(
  models: ReadonlyArray<RuntimeModelSummary>,
  options: {
    connectedOnly?: boolean;
    providerID?: string;
  },
): ReadonlyArray<RuntimeModelSummary> {
  return models.filter((model) => {
    if (options.connectedOnly && !model.connected) return false;
    if (options.providerID && model.provider !== options.providerID) return false;
    return true;
  });
}

export const CatalogServiceLive = Layer.effect(
  CatalogService,
  Effect.gen(function* () {
    const providersRef = yield* SubscriptionRef.make<
      ReadonlyArray<RuntimeProviderSummary>
    >([]);
    const modelsRef = yield* SubscriptionRef.make<
      ReadonlyArray<RuntimeModelSummary>
    >([]);

    const refreshSnapshots = Effect.gen(function* () {
      const providerRows = yield* listProviderRows();
      const providers = summarizeProviders(providerRows);
      const connectedProviders = new Set(
        providerRows.filter((row) => row.connected).map((row) => row.id),
      );
      const models = summarizeModels(yield* listModelRows(), connectedProviders);

      yield* SubscriptionRef.set(providersRef, providers);
      yield* SubscriptionRef.set(modelsRef, models);
    });

    yield* ensureProviderCatalog();
    yield* refreshSnapshots;

    return {
      ensureCatalog: () => ensureProviderCatalog().pipe(Effect.zipRight(refreshSnapshots)),
      refreshCatalog: () =>
        refreshProviderCatalog().pipe(Effect.zipRight(refreshSnapshots)),
      refreshCatalogForProvider: (providerID: string) =>
        refreshProviderCatalogForProvider(providerID).pipe(
          Effect.zipRight(refreshSnapshots),
        ),
      listProviders: () => SubscriptionRef.get(providersRef),
      streamProviders: () =>
        providersRef.changes.pipe(
          Stream.changesWith(sameSnapshot),
        ),
      listModels: (options) =>
        SubscriptionRef.get(modelsRef).pipe(
          Effect.map((models) => filterModels(models, options)),
        ),
      streamModels: (options) =>
        modelsRef.changes.pipe(
          Stream.map((models) => filterModels(models, options)),
          Stream.changesWith(sameSnapshot),
        ),
    } satisfies CatalogServiceApi;
  }),
);

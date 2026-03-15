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
import {
  replaceIfChanged,
  sameArray,
} from "@/background/services/service-snapshot-utils";
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

type CatalogSnapshot = {
  readonly providers: ReadonlyArray<RuntimeProviderSummary>;
  readonly models: ReadonlyArray<RuntimeModelSummary>;
};

function sameCapabilities(
  left: ReadonlyArray<string>,
  right: ReadonlyArray<string>,
) {
  return (
    left.length === right.length &&
    left.every((capability, index) => capability === right[index])
  );
}

function sameProviderSummary(
  left: RuntimeProviderSummary,
  right: RuntimeProviderSummary,
) {
  return (
    left.id === right.id &&
    left.name === right.name &&
    left.connected === right.connected &&
    left.env === right.env &&
    left.modelCount === right.modelCount
  );
}

function sameModelSummary(
  left: RuntimeModelSummary,
  right: RuntimeModelSummary,
) {
  return (
    left.id === right.id &&
    left.name === right.name &&
    left.provider === right.provider &&
    left.connected === right.connected &&
    sameCapabilities(left.capabilities, right.capabilities)
  );
}

function sameCatalogSnapshot(left: CatalogSnapshot, right: CatalogSnapshot) {
  return (
    sameArray(left.providers, right.providers, sameProviderSummary) &&
    sameArray(left.models, right.models, sameModelSummary)
  );
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
    const snapshotRef = yield* SubscriptionRef.make<CatalogSnapshot>({
      providers: [],
      models: [],
    });

    const refreshSnapshots = Effect.gen(function* () {
      const providerRows = yield* listProviderRows();
      const connectedProviders = new Set(
        providerRows.filter((row) => row.connected).map((row) => row.id),
      );
      const nextSnapshot = {
        providers: summarizeProviders(providerRows),
        models: summarizeModels(
          yield* listModelRows(),
          connectedProviders,
        ),
      } satisfies CatalogSnapshot;

      yield* SubscriptionRef.modify(snapshotRef, (current) => [
        undefined,
        replaceIfChanged(current, nextSnapshot, sameCatalogSnapshot),
      ]);
    });

    yield* ensureProviderCatalog();
    yield* refreshSnapshots;

    return {
      ensureCatalog: () =>
        ensureProviderCatalog().pipe(Effect.zipRight(refreshSnapshots)),
      refreshCatalog: () =>
        refreshProviderCatalog().pipe(Effect.zipRight(refreshSnapshots)),
      refreshCatalogForProvider: (providerID: string) =>
        refreshProviderCatalogForProvider(providerID).pipe(
          Effect.zipRight(refreshSnapshots),
        ),
      listProviders: () =>
        SubscriptionRef.get(snapshotRef).pipe(
          Effect.map((snapshot) => snapshot.providers),
        ),
      streamProviders: () =>
        snapshotRef.changes.pipe(
          Stream.map((snapshot) => snapshot.providers),
          Stream.changesWith((left, right) =>
            sameArray(left, right, sameProviderSummary),
          ),
        ),
      listModels: (options) =>
        SubscriptionRef.get(snapshotRef).pipe(
          Effect.map((snapshot) => filterModels(snapshot.models, options)),
        ),
      streamModels: (options) =>
        snapshotRef.changes.pipe(
          Stream.map((snapshot) => filterModels(snapshot.models, options)),
          Stream.changesWith((left, right) =>
            sameArray(left, right, sameModelSummary),
          ),
        ),
    } satisfies CatalogServiceApi;
  }),
);

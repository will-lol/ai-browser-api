import { runtimeModelKey } from "@/background/storage/runtime-db-types";
import * as Effect from "effect/Effect";
import { runtimeDb } from "@/background/storage/runtime-db";
import { ensureProviderCatalog } from "./provider-registry-refresh";
import type {
  ProviderRuntimeInfo,
} from "./provider-registry-types";

export function listProviderRows() {
  return Effect.gen(function* () {
    yield* ensureProviderCatalog();
    return yield* Effect.promise(() => runtimeDb.providers.toArray());
  });
}

export function listModelRows(
  options: {
    providerID?: string;
    connectedOnly?: boolean;
  } = {},
) {
  return Effect.gen(function* () {
    yield* ensureProviderCatalog();

    if (options.providerID) {
      const providerID = options.providerID;
      return yield* Effect.promise(() =>
        runtimeDb.models.where("providerID").equals(providerID).toArray(),
      );
    }

    if (options.connectedOnly) {
      const connectedProviderIDs = yield* Effect.promise(() =>
        runtimeDb.providers.toArray(),
      ).pipe(
        Effect.map((rows) =>
          rows.filter((row) => row.connected).map((row) => row.id),
        ),
      );

      if (connectedProviderIDs.length === 0) return [];

      return yield* Effect.promise(() =>
        runtimeDb.models.where("providerID").anyOf(connectedProviderIDs).toArray(),
      );
    }

    return yield* Effect.promise(() => runtimeDb.models.toArray());
  });
}

export function getProvider(providerID: string) {
  return Effect.gen(function* () {
    yield* ensureProviderCatalog();
    const providerRow = yield* Effect.promise(() => runtimeDb.providers.get(providerID));
    if (!providerRow) return undefined;
    return {
      id: providerRow.id,
      name: providerRow.name,
      source: providerRow.source,
      env: providerRow.env,
      connected: providerRow.connected,
      options: providerRow.options,
    } satisfies ProviderRuntimeInfo;
  });
}

export function getModel(providerID: string, modelID: string) {
  return Effect.gen(function* () {
    yield* ensureProviderCatalog();
    const row = yield* Effect.promise(() =>
      runtimeDb.models.get(runtimeModelKey(providerID, modelID)),
    );
    return row?.info;
  });
}

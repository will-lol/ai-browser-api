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
    return yield* Effect.tryPromise({
      try: () => runtimeDb.providers.toArray(),
      catch: (error) => error,
    });
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
      return yield* Effect.tryPromise({
        try: () => runtimeDb.models.where("providerID").equals(providerID).toArray(),
        catch: (error) => error,
      });
    }

    if (options.connectedOnly) {
      const connectedProviderIDs = yield* Effect.tryPromise({
        try: () => runtimeDb.providers.toArray(),
        catch: (error) => error,
      }).pipe(
        Effect.map((rows) =>
          rows.filter((row) => row.connected).map((row) => row.id),
        ),
      );

      if (connectedProviderIDs.length === 0) return [];

      return yield* Effect.tryPromise({
        try: () => runtimeDb.models.where("providerID").anyOf(connectedProviderIDs).toArray(),
        catch: (error) => error,
      });
    }

    return yield* Effect.tryPromise({
      try: () => runtimeDb.models.toArray(),
      catch: (error) => error,
    });
  });
}

export function getProvider(providerID: string) {
  return Effect.gen(function* () {
    yield* ensureProviderCatalog();
    const providerRow = yield* Effect.tryPromise({
      try: () => runtimeDb.providers.get(providerID),
      catch: (error) => error,
    });
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
    const row = yield* Effect.tryPromise({
      try: () => runtimeDb.models.get(runtimeModelKey(providerID, modelID)),
      catch: (error) => error,
    });
    return row?.info;
  });
}

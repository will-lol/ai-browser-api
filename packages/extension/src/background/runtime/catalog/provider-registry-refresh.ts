import * as Effect from "effect/Effect";
import { getModelsDevData } from "@/background/runtime/catalog/models-dev";
import { runtimeDb } from "@/background/storage/runtime-db";
import { runTx } from "@/background/storage/runtime-db-tx";
import { provideRuntimeSecurity } from "@/background/security/runtime-security";
import {
  buildProviderFromSource,
  loadProviderCatalogInputs,
  providerToRows,
} from "./provider-registry-build";
import type { ProviderInfo } from "./provider-registry-types";

const CATALOG_INITIALIZED_KEY = "catalogInitialized";

function isCatalogInitialized() {
  return Effect.promise(() => runtimeDb.meta.get(CATALOG_INITIALIZED_KEY)).pipe(
    Effect.map((value) => value?.value === true),
  );
}

export function refreshProviderCatalog() {
  return provideRuntimeSecurity(
    Effect.gen(function* () {
    const [modelsDev, [config, authMap]] = yield* Effect.all([
      getModelsDevData(),
      loadProviderCatalogInputs(),
    ]);

    const disabled = new Set(config.disabled_providers ?? []);
    const enabled = config.enabled_providers
      ? new Set(config.enabled_providers)
      : undefined;

    const providers: ProviderInfo[] = [];
    for (const [providerID, source] of Object.entries(modelsDev)) {
      if (disabled.has(providerID)) continue;
      if (enabled && !enabled.has(providerID)) continue;

      const provider = yield* buildProviderFromSource({
        providerID,
        source,
        config: config.provider?.[providerID],
        authMap,
      });
      if (provider) {
        providers.push(provider);
      }
    }

    const updatedAt = Date.now();
    const providerRows: Array<ReturnType<typeof providerToRows>["providerRow"]> =
      [];
    const modelRows: Array<
      ReturnType<typeof providerToRows>["modelRows"][number]
    > = [];

    for (const provider of providers) {
      const rows = providerToRows(provider, updatedAt);
      providerRows.push(rows.providerRow);
      modelRows.push(...rows.modelRows);
    }

    yield* Effect.promise(() =>
      runTx([runtimeDb.providers, runtimeDb.models, runtimeDb.meta], async () => {
        await runtimeDb.providers.clear();
        await runtimeDb.models.clear();

        if (providerRows.length > 0) {
          await runtimeDb.providers.bulkPut(providerRows);
        }
        if (modelRows.length > 0) {
          await runtimeDb.models.bulkPut(modelRows);
        }

        await runtimeDb.meta.put({
          key: CATALOG_INITIALIZED_KEY,
          value: true,
          updatedAt,
        });
      }),
    );

    return updatedAt;
    }),
  );
}

export function refreshProviderCatalogForProvider(providerID: string) {
  return provideRuntimeSecurity(
    Effect.gen(function* () {
    const [modelsDev, [config, authMap]] = yield* Effect.all([
      getModelsDevData(),
      loadProviderCatalogInputs(),
    ]);

    const updatedAt = Date.now();
    const source = modelsDev[providerID];

    const shouldInclude = (() => {
      if (!source) return false;
      if (config.disabled_providers?.includes(providerID)) return false;
      if (
        config.enabled_providers &&
        !config.enabled_providers.includes(providerID)
      ) {
        return false;
      }
      return true;
    })();

    const provider = shouldInclude
      ? yield* buildProviderFromSource({
          providerID,
          source,
          config: config.provider?.[providerID],
          authMap,
        })
      : undefined;

    yield* Effect.promise(() =>
      runTx([runtimeDb.providers, runtimeDb.models, runtimeDb.meta], async () => {
        await runtimeDb.models.where("providerID").equals(providerID).delete();

        if (!provider) {
          await runtimeDb.providers.delete(providerID);
        } else {
          const { providerRow, modelRows } = providerToRows(provider, updatedAt);
          await runtimeDb.providers.put(providerRow);
          if (modelRows.length > 0) {
            await runtimeDb.models.bulkPut(modelRows);
          }
        }

        await runtimeDb.meta.put({
          key: CATALOG_INITIALIZED_KEY,
          value: true,
          updatedAt,
        });
      }),
    );
    }),
  );
}

export function ensureProviderCatalog() {
  return Effect.gen(function* () {
    const initialized = yield* isCatalogInitialized();
    if (initialized) return;
    yield* refreshProviderCatalog();
  });
}

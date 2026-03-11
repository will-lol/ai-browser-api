import { publishRuntimeEvent } from "@/app/events/runtime-events";
import { getModelsDevData } from "@/background/runtime/catalog/models-dev";
import { runtimeDb } from "@/background/storage/runtime-db";
import { afterCommit, runTx } from "@/background/storage/runtime-db-tx";
import {
  buildProviderFromSource,
  loadProviderCatalogInputs,
  providerToRows,
} from "./provider-registry-build";
import type { ProviderInfo } from "./provider-registry-types";

const CATALOG_INITIALIZED_KEY = "catalogInitialized";

async function setCatalogInitialized(updatedAt: number) {
  await runtimeDb.meta.put({
    key: CATALOG_INITIALIZED_KEY,
    value: true,
    updatedAt,
  });
}

async function isCatalogInitialized() {
  const value = await runtimeDb.meta.get(CATALOG_INITIALIZED_KEY);
  return value?.value === true;
}

export async function refreshProviderCatalog() {
  const [modelsDev, [config, authMap]] = await Promise.all([
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

    const provider = await buildProviderFromSource({
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

  await runTx(
    [runtimeDb.providers, runtimeDb.models, runtimeDb.meta],
    async () => {
      await runtimeDb.providers.clear();
      await runtimeDb.models.clear();

      if (providerRows.length > 0) {
        await runtimeDb.providers.bulkPut(providerRows);
      }
      if (modelRows.length > 0) {
        await runtimeDb.models.bulkPut(modelRows);
      }

      await setCatalogInitialized(updatedAt);

      afterCommit(async () => {
        await publishRuntimeEvent({
          type: "runtime.catalog.refreshed",
          payload: { updatedAt },
        });
        await publishRuntimeEvent({
          type: "runtime.providers.changed",
          payload: { providerIDs: providerRows.map((row) => row.id) },
        });
        await publishRuntimeEvent({
          type: "runtime.models.changed",
          payload: { providerIDs: providerRows.map((row) => row.id) },
        });
      });
    },
  );

  return updatedAt;
}

export async function refreshProviderCatalogForProvider(providerID: string) {
  const [modelsDev, [config, authMap]] = await Promise.all([
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
    ? await buildProviderFromSource({
        providerID,
        source,
        config: config.provider?.[providerID],
        authMap,
      })
    : undefined;

  await runTx(
    [runtimeDb.providers, runtimeDb.models, runtimeDb.meta],
    async () => {
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

      await setCatalogInitialized(updatedAt);

      afterCommit(async () => {
        await publishRuntimeEvent({
          type: "runtime.providers.changed",
          payload: { providerIDs: [providerID] },
        });
        await publishRuntimeEvent({
          type: "runtime.models.changed",
          payload: { providerIDs: [providerID] },
        });
      });
    },
  );
}

export async function ensureProviderCatalog() {
  const initialized = await isCatalogInitialized();
  if (initialized) return;
  await refreshProviderCatalog();
}

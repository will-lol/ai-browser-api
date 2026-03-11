import { runtimeModelKey } from "@/background/storage/runtime-db-types";
import { runtimeDb } from "@/background/storage/runtime-db";
import { ensureProviderCatalog } from "./provider-registry-refresh";
import type {
  ProviderRuntimeInfo,
} from "./provider-registry-types";

export async function listProviderRows() {
  await ensureProviderCatalog();
  return runtimeDb.providers.toArray();
}

export async function listModelRows(
  options: {
    providerID?: string;
    connectedOnly?: boolean;
  } = {},
) {
  await ensureProviderCatalog();

  if (options.providerID) {
    return runtimeDb.models.where("providerID").equals(options.providerID).toArray();
  }

  if (options.connectedOnly) {
    const connectedProviderIDs = await runtimeDb.providers
      .toArray()
      .then((rows) => rows.filter((row) => row.connected).map((row) => row.id));

    if (connectedProviderIDs.length === 0) return [];

    return runtimeDb.models.where("providerID").anyOf(connectedProviderIDs).toArray();
  }

  return runtimeDb.models.toArray();
}

export async function getProvider(providerID: string) {
  await ensureProviderCatalog();
  const providerRow = await runtimeDb.providers.get(providerID);
  if (!providerRow) return undefined;
  return {
    id: providerRow.id,
    name: providerRow.name,
    source: providerRow.source,
    env: providerRow.env,
    connected: providerRow.connected,
    options: providerRow.options,
  } satisfies ProviderRuntimeInfo;
}

export async function getModel(providerID: string, modelID: string) {
  await ensureProviderCatalog();
  const row = await runtimeDb.models.get(runtimeModelKey(providerID, modelID));
  return row?.info;
}

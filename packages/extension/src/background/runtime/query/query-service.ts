import * as Effect from "effect/Effect";
import { runtimeDb } from "@/background/storage/runtime-db";
import { resolveTrustedPermissionTargets } from "@/background/runtime/permissions/permission-targets";
import {
  listModelRows,
  listProviderRows,
} from "@/background/runtime/catalog/provider-registry";
import {
  getOriginPermissions,
  listPendingRequests,
  listPermissions,
} from "@/background/runtime/permissions";

export function listProviders() {
  return Effect.gen(function* () {
    const rows = yield* listProviderRows();

    return rows
      .map((row) => ({
        id: row.id,
        name: row.name,
        connected: row.connected,
        env: row.env,
        modelCount: row.modelCount,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  });
}

export function listModels(
  options: {
    connectedOnly?: boolean;
    providerID?: string;
  } = {},
) {
  return Effect.gen(function* () {
    const [modelRows, providerRows] = yield* Effect.all([
      listModelRows(options),
      listProviderRows(),
    ]);

    const providers = new Map(
      providerRows.map((row) => [row.id, row] as const),
    );

    return modelRows
      .map((row) => {
        const provider = providers.get(row.providerID);
        return {
          id: row.id,
          name: row.info.name,
          provider: row.providerID,
          capabilities: row.capabilities,
          connected: provider?.connected ?? false,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  });
}

export function getOriginState(origin: string) {
  return Effect.gen(function* () {
    const state = yield* getOriginPermissions(origin);

    return {
      origin,
      enabled: state.enabled,
    };
  });
}

export function listPermissionsForOrigin(origin: string) {
  return Effect.gen(function* () {
    const rows = yield* listPermissions(origin);
    if (rows.length === 0) {
      return [];
    }

    const modelRows = yield* Effect.promise(() =>
      runtimeDb.models.bulkGet(rows.map((row) => row.modelId)),
    );
    const modelById = new Map(
      modelRows
        .filter((row): row is NonNullable<typeof row> => row != null)
        .map((row) => [row.id, row] as const),
    );

    return rows.map((row) => {
      const modelRow = modelById.get(row.modelId);
      const fallbackProvider = row.modelId.split("/")[0] ?? "unknown";
      const fallbackName = row.modelId.split("/")[1] ?? row.modelId;

      return {
        modelId: row.modelId,
        modelName: modelRow?.info.name ?? fallbackName,
        provider: modelRow?.providerID ?? fallbackProvider,
        status: row.status,
        capabilities: modelRow?.capabilities ?? row.capabilities,
        requestedAt: row.updatedAt,
      };
    });
  });
}

export function listPendingRequestsForOrigin(origin: string) {
  return Effect.gen(function* () {
    const rows = yield* listPendingRequests(origin);
    if (rows.length === 0) {
      return [];
    }

    const trustedTargets = yield* resolveTrustedPermissionTargets(
      rows.map((row) => row.modelId),
    );

    return rows.flatMap((row) => {
      const target = trustedTargets.get(row.modelId);
      if (!target) {
        return [];
      }

      return [
        {
          ...row,
          modelName: target.modelName,
          provider: target.provider,
          capabilities: target.capabilities,
        },
      ];
    });
  });
}

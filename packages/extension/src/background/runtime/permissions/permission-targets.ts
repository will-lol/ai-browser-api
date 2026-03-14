import { runtimeDb } from "@/background/storage/runtime-db";
import * as Effect from "effect/Effect";

interface TrustedPermissionTarget {
  modelId: string;
  modelName: string;
  provider: string;
  capabilities: string[];
}

type TrustedPermissionTargetResolution =
  | {
      status: "resolved";
      target: TrustedPermissionTarget;
    }
  | {
      status: "missing";
      modelId: string;
    }
  | {
      status: "disconnected";
      modelId: string;
      provider: string;
    };

function resolveTrustedPermissionTargetResolutions(
  modelIds: ReadonlyArray<string>,
): Effect.Effect<Map<string, TrustedPermissionTargetResolution>, unknown> {
  return Effect.gen(function* () {
    const uniqueModelIds = Array.from(new Set(modelIds));
    if (uniqueModelIds.length === 0) {
      return new Map();
    }

    const modelRows = yield* Effect.tryPromise({
      try: () => runtimeDb.models.bulkGet(uniqueModelIds),
      catch: (error) => error,
    });
    const providerIDs = Array.from(
      new Set(modelRows.flatMap((row) => (row ? [row.providerID] : []))),
    );
    const providerRows =
      providerIDs.length === 0
        ? []
        : yield* Effect.tryPromise({
            try: () => runtimeDb.providers.bulkGet(providerIDs),
            catch: (error) => error,
          });
    const providerById = new Map(
      providerRows
        .filter((row): row is NonNullable<typeof row> => row != null)
        .map((row) => [row.id, row] as const),
    );
    const resolutions = new Map<string, TrustedPermissionTargetResolution>();

    modelRows.forEach((row, index) => {
      const modelId = uniqueModelIds[index];
      if (!modelId) return;

      if (!row) {
        resolutions.set(modelId, {
          status: "missing",
          modelId,
        });
        return;
      }

      const provider = providerById.get(row.providerID);
      if (!provider) {
        resolutions.set(modelId, {
          status: "missing",
          modelId,
        });
        return;
      }

      if (!provider.connected) {
        resolutions.set(modelId, {
          status: "disconnected",
          modelId,
          provider: row.providerID,
        });
        return;
      }

      resolutions.set(modelId, {
        status: "resolved",
        target: {
          modelId,
          modelName: row.info.name,
          provider: row.providerID,
          capabilities: [...row.capabilities],
        },
      });
    });

    return resolutions;
  });
}

export function resolveTrustedPermissionTarget(modelId: string) {
  return Effect.gen(function* () {
    return (
      (yield* resolveTrustedPermissionTargetResolutions([modelId])).get(
        modelId,
      ) ?? {
        status: "missing" as const,
        modelId,
      }
    );
  });
}

import { runtimeDb } from "@/lib/runtime/db/runtime-db";

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

async function resolveTrustedPermissionTargetResolutions(
  modelIds: ReadonlyArray<string>,
): Promise<Map<string, TrustedPermissionTargetResolution>> {
  const uniqueModelIds = Array.from(new Set(modelIds));
  if (uniqueModelIds.length === 0) {
    return new Map();
  }

  const modelRows = await runtimeDb.models.bulkGet(uniqueModelIds);
  const providerIDs = Array.from(
    new Set(modelRows.flatMap((row) => (row ? [row.providerID] : []))),
  );
  const providerRows =
    providerIDs.length === 0
      ? []
      : await runtimeDb.providers.bulkGet(providerIDs);
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
}

export async function resolveTrustedPermissionTargets(
  modelIds: ReadonlyArray<string>,
): Promise<Map<string, TrustedPermissionTarget>> {
  const targets = new Map<string, TrustedPermissionTarget>();
  const resolutions = await resolveTrustedPermissionTargetResolutions(modelIds);

  for (const [modelId, resolution] of resolutions) {
    if (resolution.status !== "resolved") continue;
    targets.set(modelId, resolution.target);
  }

  return targets;
}

export async function resolveTrustedPermissionTarget(modelId: string) {
  return (
    (await resolveTrustedPermissionTargetResolutions([modelId])).get(
      modelId,
    ) ?? {
      status: "missing",
      modelId,
    }
  );
}

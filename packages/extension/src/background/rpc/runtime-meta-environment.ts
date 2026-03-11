import {
  ModelNotFoundError,
  ProviderNotConnectedError,
} from "@llm-bridge/contracts";
import type { RuntimeEnvironmentApi } from "@llm-bridge/runtime-core";
import { ensureProviderCatalog } from "@/background/runtime/catalog/provider-registry";
import { resolveTrustedPermissionTarget } from "@/background/runtime/permissions/permission-targets";
import { parseProviderModel } from "@/background/runtime/core/util";
import { tryExtensionPromise } from "@/background/rpc/runtime-environment-shared";

export function makeRuntimeMetaEnvironment(): RuntimeEnvironmentApi["meta"] {
  return {
    parseProviderModel,
    resolvePermissionTarget: (modelID: string) =>
      tryExtensionPromise("meta.resolvePermissionTarget", async () => {
        await ensureProviderCatalog();
        const resolution = await resolveTrustedPermissionTarget(modelID);
        if (resolution.status === "resolved") {
          return resolution.target;
        }
        if (resolution.status === "disconnected") {
          throw new ProviderNotConnectedError({
            providerID: resolution.provider,
            message: `Provider ${resolution.provider} is not connected`,
          });
        }

        throw new ModelNotFoundError({
          modelId: modelID,
          message: `Model ${modelID} was not found`,
        });
      }),
  };
}

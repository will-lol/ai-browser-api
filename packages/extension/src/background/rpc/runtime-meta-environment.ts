import * as Effect from "effect/Effect";
import {
  ModelNotFoundError,
  ProviderNotConnectedError,
} from "@llm-bridge/contracts";
import type { RuntimeEnvironmentApi } from "@llm-bridge/runtime-core";
import { ensureProviderCatalog } from "@/background/runtime/catalog/provider-registry";
import { resolveTrustedPermissionTarget } from "@/background/runtime/permissions/permission-targets";
import { parseProviderModel } from "@/background/runtime/core/util";

export function makeRuntimeMetaEnvironment(): RuntimeEnvironmentApi["meta"] {
  return {
    parseProviderModel,
    resolvePermissionTarget: (modelID: string) =>
      Effect.gen(function* () {
        yield* ensureProviderCatalog();
        const resolution = yield* resolveTrustedPermissionTarget(modelID);
        if (resolution.status === "resolved") {
          return resolution.target;
        }
        if (resolution.status === "disconnected") {
          return yield* new ProviderNotConnectedError({
            providerID: resolution.provider,
            message: `Provider ${resolution.provider} is not connected`,
          });
        }

        return yield* new ModelNotFoundError({
          modelId: modelID,
          message: `Model ${modelID} was not found`,
        });
      }),
  };
}

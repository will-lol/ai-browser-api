import {
  MetaService,
  type MetaServiceApi,
} from "@llm-bridge/runtime-core";
import {
  ModelNotFoundError,
  ProviderNotConnectedError,
} from "@llm-bridge/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { ensureProviderCatalog } from "@/background/runtime/catalog/provider-registry";
import { parseProviderModel } from "@/background/runtime/core/util";
import { resolveTrustedPermissionTarget } from "@/background/runtime/permissions/permission-targets";

export const MetaServiceLive = Layer.succeed(MetaService, {
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
} satisfies MetaServiceApi);

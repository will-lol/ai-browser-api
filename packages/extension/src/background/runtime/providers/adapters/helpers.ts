import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
} from "@ai-sdk/provider";
import * as Effect from "effect/Effect";
import type { RuntimeRpcError } from "@llm-bridge/contracts";

export function wrapLanguageModel(
  model: LanguageModelV3,
  mutate: (
    options: LanguageModelV3CallOptions,
  ) => Effect.Effect<LanguageModelV3CallOptions, RuntimeRpcError>,
): LanguageModelV3 {
  return {
    specificationVersion: model.specificationVersion,
    provider: model.provider,
    modelId: model.modelId,
    supportedUrls: model.supportedUrls,
    doGenerate: async (options) =>
      model.doGenerate(await Effect.runPromise(mutate(options))),
    doStream: async (options) =>
      model.doStream(await Effect.runPromise(mutate(options))),
  };
}

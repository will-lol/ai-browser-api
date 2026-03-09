import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
} from "@ai-sdk/provider";

export function wrapLanguageModel(
  model: LanguageModelV3,
  mutate: (
    options: LanguageModelV3CallOptions,
  ) =>
    | Promise<LanguageModelV3CallOptions>
    | LanguageModelV3CallOptions,
): LanguageModelV3 {
  return {
    specificationVersion: model.specificationVersion,
    provider: model.provider,
    modelId: model.modelId,
    supportedUrls: model.supportedUrls,
    doGenerate: async (options) => model.doGenerate(await mutate(options)),
    doStream: async (options) => model.doStream(await mutate(options)),
  };
}

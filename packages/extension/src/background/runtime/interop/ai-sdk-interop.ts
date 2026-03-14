import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
} from "@ai-sdk/provider";
import type { RuntimeRpcError } from "@llm-bridge/contracts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

// This is the explicit background-side AI SDK interop boundary.
// Promise and ReadableStream adaptation should stay here, not leak into service code.
export function wrapLanguageModelCallOptionsBoundary(
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

export function readableStreamToEffectStream<A, B, E>(input: {
  stream: ReadableStream<A>;
  map: (chunk: A) => Effect.Effect<B, E>;
  mapError: (error: unknown) => E;
}): Stream.Stream<B, E> {
  return Stream.fromReadableStream(
    () => input.stream,
    input.mapError,
  ).pipe(Stream.mapEffect(input.map));
}

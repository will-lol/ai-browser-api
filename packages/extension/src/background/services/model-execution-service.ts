import { fromRuntimeModelCallOptions, toRuntimeGenerateResponse } from "@llm-bridge/bridge-codecs";
import { encodeSupportedUrls } from "@llm-bridge/contracts";
import {
  ModelExecutionService,
  type ModelExecutionServiceApi,
} from "@llm-bridge/runtime-core";
import * as Layer from "effect/Layer";
import * as Effect from "effect/Effect";
import {
  getRuntimeModelDescriptor,
  runLanguageModelGenerate,
  runLanguageModelStream,
} from "@/background/runtime/execution/language-model-runtime";

export const ModelExecutionServiceLive = Layer.succeed(
  ModelExecutionService,
  {
    acquireModel: (input) =>
      getRuntimeModelDescriptor({
        modelID: input.modelID,
        origin: input.origin,
        sessionID: input.sessionID,
        requestID: input.requestID,
      }).pipe(
        Effect.map((descriptor) => ({
          specificationVersion: "v3" as const,
          provider: descriptor.provider,
          modelId: descriptor.modelId,
          supportedUrls: encodeSupportedUrls(descriptor.supportedUrls),
        })),
      ),
    generateModel: (input) =>
      runLanguageModelGenerate({
        modelID: input.modelID,
        origin: input.origin,
        sessionID: input.sessionID,
        requestID: input.requestID,
        options: fromRuntimeModelCallOptions(input.options),
        signal: input.signal,
      }).pipe(Effect.map((result) => toRuntimeGenerateResponse(result))),
    streamModel: (input) =>
      runLanguageModelStream({
        modelID: input.modelID,
        origin: input.origin,
        sessionID: input.sessionID,
        requestID: input.requestID,
        options: fromRuntimeModelCallOptions(input.options),
        signal: input.signal,
      }),
  } satisfies ModelExecutionServiceApi,
);

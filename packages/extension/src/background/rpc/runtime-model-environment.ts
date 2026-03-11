import * as Effect from "effect/Effect";
import { fromRuntimeModelCallOptions, toRuntimeGenerateResponse } from "@llm-bridge/bridge-codecs";
import { encodeSupportedUrls } from "@llm-bridge/contracts";
import type { RuntimeEnvironmentApi } from "@llm-bridge/runtime-core";
import {
  getRuntimeModelDescriptor,
  runLanguageModelGenerate,
  runLanguageModelStream,
} from "@/background/runtime/execution/language-model-runtime";
import {
  mapLanguageModelStream,
} from "@/background/rpc/runtime-environment-shared";

export function makeRuntimeModelExecutionEnvironment(): RuntimeEnvironmentApi["modelExecution"] {
  return {
    acquireModel: (input) =>
      getRuntimeModelDescriptor({
          modelID: input.modelID,
          origin: input.origin,
          sessionID: input.sessionID,
          requestID: input.requestID,
        }).pipe(Effect.map((descriptor) => ({
          specificationVersion: "v3",
          provider: descriptor.provider,
          modelId: descriptor.modelId,
          supportedUrls: encodeSupportedUrls(descriptor.supportedUrls),
        }))),
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
        }).pipe(Effect.map((stream) => mapLanguageModelStream(stream))),
  };
}

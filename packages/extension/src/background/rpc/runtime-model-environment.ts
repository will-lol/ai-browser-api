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
  tryExtensionPromise,
} from "@/background/rpc/runtime-environment-shared";

export function makeRuntimeModelExecutionEnvironment(): RuntimeEnvironmentApi["modelExecution"] {
  return {
    acquireModel: (input) =>
      tryExtensionPromise("model.acquire", () =>
        getRuntimeModelDescriptor({
          modelID: input.modelID,
          origin: input.origin,
          sessionID: input.sessionID,
          requestID: input.requestID,
        }).then((descriptor) => ({
          specificationVersion: "v3",
          provider: descriptor.provider,
          modelId: descriptor.modelId,
          supportedUrls: encodeSupportedUrls(descriptor.supportedUrls),
        })),
      ),
    generateModel: (input) =>
      tryExtensionPromise("model.generate", () =>
        runLanguageModelGenerate({
          modelID: input.modelID,
          origin: input.origin,
          sessionID: input.sessionID,
          requestID: input.requestID,
          options: fromRuntimeModelCallOptions(input.options),
          signal: input.signal,
        }).then((result) => toRuntimeGenerateResponse(result)),
      ),
    streamModel: (input) =>
      tryExtensionPromise("model.stream", () =>
        runLanguageModelStream({
          modelID: input.modelID,
          origin: input.origin,
          sessionID: input.sessionID,
          requestID: input.requestID,
          options: fromRuntimeModelCallOptions(input.options),
          signal: input.signal,
        }).then((stream) => mapLanguageModelStream(stream)),
      ),
  };
}

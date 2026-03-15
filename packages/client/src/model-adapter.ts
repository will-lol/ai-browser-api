import {
  fromRuntimeGenerateResponse,
  fromRuntimeStreamPart,
  toRuntimeModelCallOptions,
} from "@llm-bridge/bridge-codecs";
import {
  decodeSupportedUrls,
  type BridgeModelDescriptorResponse,
  type RuntimeRpcError,
} from "@llm-bridge/contracts";
import {
  type LanguageModelV3,
  type LanguageModelV3StreamPart,
} from "@ai-sdk/provider";
import * as Effect from "effect/Effect";
import type { BridgeConnection } from "./connection";
import {
  attachAbortEffect,
  bufferReadableStreamPrefix,
  effectStreamToReadableStream,
  runClientTransport,
  runDetachedClientTransport,
} from "./transport-boundary";
import {
  createAbortError,
  isBootstrapRuntimeStreamPart,
  logBridgeDebug,
  logBridgeError,
  normalizeModelCallError,
} from "./shared";

export function createLanguageModelAdapter(input: {
  modelId: string;
  descriptor: BridgeModelDescriptorResponse;
  ensureConnection: Effect.Effect<BridgeConnection, RuntimeRpcError>;
  abortRequest: (request: {
    requestId: string;
    sessionID: string;
  }) => Effect.Effect<void, RuntimeRpcError>;
  nextRequestId: () => string;
}): LanguageModelV3 {
  const { modelId, descriptor } = input;

  return {
    specificationVersion: descriptor.specificationVersion,
    provider: descriptor.provider,
    modelId: descriptor.modelId,
    supportedUrls: decodeSupportedUrls(descriptor.supportedUrls),
    async doGenerate(options) {
      const requestId = input.nextRequestId();
      const abortSignal = options.abortSignal;
      const runtimeOptions = toRuntimeModelCallOptions(options);
      logBridgeDebug("doGenerate.started", { modelId, requestId });

      if (abortSignal?.aborted) {
        throw createAbortError();
      }

      const cleanupAbort = attachAbortEffect({
        signal: abortSignal,
        effect: input.abortRequest({
          requestId,
          sessionID: requestId,
        }),
        onError: () => undefined,
      });

      try {
        const response = await runClientTransport(
          Effect.gen(function* () {
            if (abortSignal?.aborted) {
              return yield* Effect.fail(createAbortError());
            }

            const current = yield* input.ensureConnection;
            const generated = yield* current.client.modelDoGenerate({
              requestId,
              sessionID: requestId,
              modelId,
              options: runtimeOptions,
            });

            return fromRuntimeGenerateResponse(generated);
          }),
        );

        logBridgeDebug("doGenerate.succeeded", { modelId, requestId });
        return response;
      } catch (error) {
        const normalized = normalizeModelCallError({
          error,
          operation: "generate",
          modelId,
          requestBodyValues: runtimeOptions,
        });
        logBridgeError("doGenerate.failed", normalized, {
          modelId,
          requestId,
        });
        throw normalized;
      } finally {
        cleanupAbort();
      }
    },
    async doStream(options) {
      const requestId = input.nextRequestId();
      const abortSignal = options.abortSignal;
      const runtimeOptions = toRuntimeModelCallOptions(options);
      logBridgeDebug("doStream.started", { modelId, requestId });

      if (abortSignal?.aborted) {
        throw createAbortError();
      }

      try {
        const runtimeStream = await effectStreamToReadableStream(
          Effect.gen(function* () {
            if (abortSignal?.aborted) {
              return yield* Effect.fail(createAbortError());
            }

            const current = yield* input.ensureConnection;
            return current.client.modelDoStream({
              requestId,
              sessionID: requestId,
              modelId,
              options: runtimeOptions,
            });
          }),
        );

        const reader = runtimeStream.getReader();
        const cleanupAbort = attachAbortEffect({
          signal: abortSignal,
          effect: input.abortRequest({
            requestId,
            sessionID: requestId,
          }),
          onError: () => undefined,
        });

        const { buffered: bufferedParts, done: streamFinishedDuringBootstrap } =
          await bufferReadableStreamPrefix({
            reader,
            map: (value) => fromRuntimeStreamPart(value),
            keepBuffering: (part) => isBootstrapRuntimeStreamPart(part),
          });

        let bufferedIndex = 0;
        let completed = false;

        const finishStream = () => {
          if (completed) return;
          completed = true;
          cleanupAbort();
          logBridgeDebug("doStream.completed", {
            modelId,
            requestId,
          });
        };

        return {
          stream: new ReadableStream<LanguageModelV3StreamPart>({
            async pull(controller) {
              if (bufferedIndex < bufferedParts.length) {
                controller.enqueue(bufferedParts[bufferedIndex]!);
                bufferedIndex += 1;
                return;
              }

              if (streamFinishedDuringBootstrap) {
                finishStream();
                controller.close();
                return;
              }

              try {
                const next = await reader.read();
                if (next.done) {
                  finishStream();
                  controller.close();
                  return;
                }

                controller.enqueue(fromRuntimeStreamPart(next.value));
              } catch (error) {
                cleanupAbort();
                const normalized = normalizeModelCallError({
                  error,
                  operation: "stream",
                  modelId,
                  requestBodyValues: runtimeOptions,
                });
                logBridgeError("doStream.pullFailed", normalized, {
                  modelId,
                  requestId,
                });
                throw normalized;
              }
            },
            async cancel() {
              try {
                logBridgeDebug("doStream.canceled", {
                  modelId,
                  requestId,
                });
                await reader.cancel();
              } finally {
                cleanupAbort();
                runDetachedClientTransport(
                  input.abortRequest({
                    requestId,
                    sessionID: requestId,
                  }),
                  {
                    onError: () => undefined,
                  },
                );
              }
            },
          }),
        };
      } catch (error) {
        const normalized = normalizeModelCallError({
          error,
          operation: "stream",
          modelId,
          requestBodyValues: runtimeOptions,
        });
        logBridgeError("doStream.failed", normalized, {
          modelId,
          requestId,
        });
        throw normalized;
      }
    },
  };
}

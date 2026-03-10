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
import { type LanguageModelV3, type LanguageModelV3StreamPart } from "@ai-sdk/provider";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import type { BridgeConnection } from "./connection";
import {
  createAbortError,
  currentOrigin,
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

      const onAbort = () => {
        void Effect.runPromise(
          input.abortRequest({
            requestId,
            sessionID: requestId,
          }),
        ).catch(() => undefined);
      };

      abortSignal?.addEventListener("abort", onAbort, { once: true });

      try {
        const response = await Effect.runPromise(
          Effect.gen(function* () {
            if (abortSignal?.aborted) {
              return yield* Effect.fail(createAbortError());
            }

            const current = yield* input.ensureConnection;
            const generated = yield* current.client.modelDoGenerate({
              origin: currentOrigin(),
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
        abortSignal?.removeEventListener("abort", onAbort);
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
        const runtimeStream = await Effect.runPromise(
          Effect.gen(function* () {
            if (abortSignal?.aborted) {
              return yield* Effect.fail(createAbortError());
            }

            const current = yield* input.ensureConnection;
            return yield* Effect.scoped(
              Stream.toReadableStreamEffect(
                current.client.modelDoStream({
                  origin: currentOrigin(),
                  requestId,
                  sessionID: requestId,
                  modelId,
                  options: runtimeOptions,
                }),
              ),
            );
          }),
        );

        const reader = runtimeStream.getReader();
        const onAbort = () => {
          void Effect.runPromise(
            input.abortRequest({
              requestId,
              sessionID: requestId,
            }),
          ).catch(() => undefined);
        };

        abortSignal?.addEventListener("abort", onAbort, { once: true });

        const cleanup = () => {
          abortSignal?.removeEventListener("abort", onAbort);
        };

        const bufferedParts = [] as Array<LanguageModelV3StreamPart>;
        let streamFinishedDuringBootstrap = false;

        while (true) {
          const next = await reader.read();
          if (next.done) {
            streamFinishedDuringBootstrap = true;
            break;
          }

          const part = fromRuntimeStreamPart(next.value);
          bufferedParts.push(part);
          if (!isBootstrapRuntimeStreamPart(part)) {
            break;
          }
        }

        let bufferedIndex = 0;
        let completed = false;

        const finishStream = () => {
          if (completed) return;
          completed = true;
          cleanup();
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
                cleanup();
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
                cleanup();
                void Effect.runPromise(
                  input.abortRequest({
                    requestId,
                    sessionID: requestId,
                  }),
                ).catch(() => undefined);
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

import type { LanguageModelV3StreamPart } from "@ai-sdk/provider";
import { toRuntimeStreamPart } from "@llm-bridge/bridge-codecs";
import {
  isRuntimeRpcError,
  type RuntimeRpcError,
  type RuntimeStreamPart,
} from "@llm-bridge/contracts";
import * as Effect from "effect/Effect";
import {
  wrapExtensionError,
  wrapStorageError,
} from "@/background/runtime/core/errors";

const tryPromise = <A>(
  tryFn: () => Promise<A>,
  onError: (error: unknown) => RuntimeRpcError,
) =>
  Effect.tryPromise({
    try: tryFn,
    catch: (error): RuntimeRpcError =>
      isRuntimeRpcError(error) ? error : onError(error),
  });

export const tryExtensionPromise = <A>(
  operation: string,
  tryFn: () => Promise<A>,
) => tryPromise(tryFn, (error) => wrapExtensionError(error, operation));

export const tryStoragePromise = <A>(
  operation: string,
  tryFn: () => Promise<A>,
) => tryPromise(tryFn, (error) => wrapStorageError(error, operation));

export function mapLanguageModelStream(
  stream: ReadableStream<LanguageModelV3StreamPart>,
): ReadableStream<RuntimeStreamPart> {
  const reader = stream.getReader();

  return new ReadableStream<RuntimeStreamPart>({
    async pull(controller) {
      const chunk = await reader.read();
      if (chunk.done) {
        controller.close();
        return;
      }

      controller.enqueue(toRuntimeStreamPart(chunk.value));
    },
    async cancel() {
      await reader.cancel();
    },
  });
}

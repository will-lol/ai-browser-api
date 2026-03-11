import type { LanguageModelV3StreamPart } from "@ai-sdk/provider";
import { toRuntimeStreamPart } from "@llm-bridge/bridge-codecs";
import { type RuntimeStreamPart } from "@llm-bridge/contracts";

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

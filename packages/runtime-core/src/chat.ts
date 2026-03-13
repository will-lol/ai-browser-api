import type {
  RuntimeAbortChatStreamInput,
  RuntimeChatReconnectStreamInput,
  RuntimeChatSendMessagesInput,
} from "@llm-bridge/contracts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { ChatExecutionService } from "./environment";

export function sendChatMessages(input: RuntimeChatSendMessagesInput) {
  return Stream.unwrap(
    Effect.flatMap(ChatExecutionService, (service) => service.sendMessages(input)),
  );
}

export function reconnectChatStream(input: RuntimeChatReconnectStreamInput) {
  return Stream.unwrap(
    Effect.flatMap(ChatExecutionService, (service) =>
      service.reconnectStream(input),
    ),
  );
}

export function abortChatStream(input: RuntimeAbortChatStreamInput) {
  return Effect.flatMap(ChatExecutionService, (service) =>
    service.abortStream(input),
  );
}

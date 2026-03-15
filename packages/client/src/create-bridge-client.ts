import {
  RuntimeValidationError,
  type RuntimeRpcError,
} from "@llm-bridge/contracts";
import { makeResettableConnectionLifecycle } from "@llm-bridge/runtime-core";
import * as Effect from "effect/Effect";
import { makeBridgeClientApi, type BridgeClientApi } from "./client-api";
import {
  closeConnection,
  createConnection,
  type BridgeConnection,
} from "./connection";
import { createLanguageModelAdapter } from "./model-adapter";
import {
  CONNECTION_INVALIDATED_MESSAGE,
  nextRequestId,
} from "./shared";
import { runClientTransport } from "./transport-boundary";
import type { BridgeClientOptions } from "./types";

export function createBridgeClientEffect(
  options: BridgeClientOptions = {},
) {
  return Effect.gen(function* () {
    let sequence = 0;
    const lifecycle = yield* makeResettableConnectionLifecycle<
      BridgeConnection,
      RuntimeRpcError
    >({
      create: (connectionId) => createConnection(connectionId, options),
      close: (connection, reason) =>
        closeConnection(connection, {
          reason,
        }),
      invalidatedError: () =>
        new RuntimeValidationError({
          message: CONNECTION_INVALIDATED_MESSAGE,
        }),
    });

    const ensureConnection = lifecycle.ensure;

    const abortRequest = (input: { requestId: string; sessionID: string }) =>
      ensureConnection.pipe(
        Effect.flatMap((current) =>
          current.client.abortModelCall({
            requestId: input.requestId,
            sessionID: input.sessionID,
          }),
        ),
        Effect.asVoid,
      );

    const abortChatStream = (chatId: string) =>
      ensureConnection.pipe(
        Effect.flatMap((current) =>
          current.client.abortChatStream({
            chatId,
          }),
        ),
        Effect.asVoid,
      );

    const destroy = lifecycle.destroy.pipe(
      Effect.catchAll(() => Effect.void),
    );

    return makeBridgeClientApi({
      ensureConnection,
      destroy,
      abortChatStream,
      createLanguageModel: (modelId, descriptor) =>
        createLanguageModelAdapter({
          modelId,
          descriptor,
          ensureConnection,
          abortRequest,
          nextRequestId: () => {
            sequence += 1;
            return nextRequestId(sequence);
          },
        }),
      nextModelRequestId: () => {
        sequence += 1;
        return nextRequestId(sequence);
      },
    });
  });
}

export function createBridgeClient(
  options: BridgeClientOptions = {},
): Promise<BridgeClientApi> {
  return runClientTransport(createBridgeClientEffect(options));
}

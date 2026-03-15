import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { RuntimeChatStreamNotFoundError } from "@llm-bridge/contracts";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { createChatTransport } from "./chat-transport";
import type { BridgeConnection } from "./connection";

const activeConnections: Array<BridgeConnection> = [];

function asChatSendMessages(
  stream: Stream.Stream<{ readonly [key: string]: unknown }, never>,
) {
  return (() => stream) as BridgeConnection["client"]["chatSendMessages"];
}

function asChatReconnectStream(
  stream: Stream.Stream<{ readonly [key: string]: unknown }, unknown>,
) {
  return (() => stream) as BridgeConnection["client"]["chatReconnectStream"];
}

function asAbortChatStream(effect: Effect.Effect<void>) {
  return (() => effect) as BridgeConnection["client"]["abortChatStream"];
}

function makeUiMessage() {
  return {
    id: "message-1",
    role: "user" as const,
    parts: [
      {
        type: "text" as const,
        text: "hello",
      },
    ],
  };
}

async function makeConnection(input: {
  chatSendMessages?: BridgeConnection["client"]["chatSendMessages"];
  chatReconnectStream?: BridgeConnection["client"]["chatReconnectStream"];
  abortChatStream?: BridgeConnection["client"]["abortChatStream"];
}) {
  const scope = await Effect.runPromise(Scope.make());
  const channel = new MessageChannel();

  const connection = {
    connectionId: 1,
    scope,
    port: channel.port1,
    client: {
      chatSendMessages:
        input.chatSendMessages ??
        asChatSendMessages(
          Stream.empty as Stream.Stream<{ readonly [key: string]: unknown }, never>,
        ),
      chatReconnectStream:
        input.chatReconnectStream ??
        asChatReconnectStream(
          Stream.empty as Stream.Stream<{ readonly [key: string]: unknown }, never>,
        ),
      abortChatStream:
        input.abortChatStream ?? asAbortChatStream(Effect.succeed(undefined)),
    } as BridgeConnection["client"],
  } satisfies BridgeConnection;

  activeConnections.push(connection);
  return connection;
}

async function cleanupConnections() {
  while (activeConnections.length > 0) {
    const connection = activeConnections.pop();
    if (!connection) {
      continue;
    }

    connection.port.close();
    await Effect.runPromise(
      Scope.close(connection.scope, Exit.succeed(undefined)),
    );
  }
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 250,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) {
      return;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }

  throw new Error("Timed out waiting for condition");
}

afterEach(async () => {
  await cleanupConnections();
});

describe("createChatTransport", () => {
  it("returns null when reconnect sees an immediate RuntimeChatStreamNotFoundError", async () => {
    const connection = await makeConnection({
      chatReconnectStream: asChatReconnectStream(
        Stream.fail(
          new RuntimeChatStreamNotFoundError({
            origin: "https://chat.example.com",
            chatId: "chat-1",
            message: "missing",
          }),
        ) as Stream.Stream<{ readonly [key: string]: unknown }, RuntimeChatStreamNotFoundError>,
      ),
    });

    const transport = createChatTransport({
      ensureConnection: Effect.succeed(connection),
      abortChatStream: () => Effect.void,
    });

    const result = await transport.reconnectToStream({
      chatId: "chat-1",
      headers: undefined,
    });

    assert.equal(result, null);
  });

  it("returns a readable stream for an active reconnect stream", async () => {
    const connection = await makeConnection({
      chatReconnectStream: asChatReconnectStream(
        Stream.succeed({
          kind: "live",
        }),
      ),
    });

    const transport = createChatTransport({
      ensureConnection: Effect.succeed(connection),
      abortChatStream: () => Effect.void,
    });

    const result = await transport.reconnectToStream({
      chatId: "chat-1",
      headers: undefined,
    });

    assert.ok(result instanceof ReadableStream);
    const reader = result.getReader();
    const first = await reader.read();
    assert.deepEqual(first, {
      done: false,
      value: {
        kind: "live",
      },
    });
  });

  it("sends page bridge chat payloads without an origin field", async () => {
    const sendCalls: Array<Record<string, unknown>> = [];
    const reconnectCalls: Array<Record<string, unknown>> = [];

    const connection = await makeConnection({
      chatSendMessages: ((input: Record<string, unknown>) => {
        sendCalls.push(input);
        return Stream.empty;
      }) as BridgeConnection["client"]["chatSendMessages"],
      chatReconnectStream: ((input: Record<string, unknown>) => {
        reconnectCalls.push(input);
        return Stream.empty;
      }) as BridgeConnection["client"]["chatReconnectStream"],
    });

    const transport = createChatTransport({
      ensureConnection: Effect.succeed(connection),
      abortChatStream: () => Effect.void,
    });

    await transport.sendMessages({
      chatId: "chat-1",
      trigger: "submit-message",
      messageId: "message-1",
      messages: [makeUiMessage()],
      abortSignal: undefined,
      headers: undefined,
      body: {
        modelId: "openai/gpt-4o-mini",
      },
      metadata: undefined,
    });
    await transport.reconnectToStream({
      chatId: "chat-1",
      headers: undefined,
    });

    assert.deepEqual(sendCalls, [
      {
        chatId: "chat-1",
        modelId: "openai/gpt-4o-mini",
        trigger: "submit-message",
        messageId: "message-1",
        messages: [makeUiMessage()],
        options: undefined,
      },
    ]);
    assert.deepEqual(reconnectCalls, [
      {
        chatId: "chat-1",
      },
    ]);
  });

  it("does not abort on reader cancel, but does abort on explicit abort signal", async () => {
    const abortCalls: Array<string> = [];
    const connection = await makeConnection({
      chatSendMessages: asChatSendMessages(
        Stream.never as Stream.Stream<{ readonly [key: string]: unknown }, never>,
      ),
      abortChatStream: (({ chatId }) =>
        Effect.sync(() => {
          abortCalls.push(chatId);
        })) as BridgeConnection["client"]["abortChatStream"],
    });

    const transport = createChatTransport({
      ensureConnection: Effect.succeed(connection),
      abortChatStream: (chatId) =>
        Effect.sync(() => {
          abortCalls.push(chatId);
        }),
    });

    const canceledStream = await transport.sendMessages({
      chatId: "chat-1",
      trigger: "submit-message",
      messageId: "message-1",
      messages: [makeUiMessage()],
      abortSignal: undefined,
      headers: undefined,
      body: {
        modelId: "openai/gpt-4o-mini",
      },
      metadata: undefined,
    });
    const canceledReader = canceledStream.getReader();
    await canceledReader.cancel();

    assert.deepEqual(abortCalls, []);

    const controller = new AbortController();
    await transport.sendMessages({
      chatId: "chat-1",
      trigger: "submit-message",
      messageId: "message-2",
      messages: [makeUiMessage()],
      abortSignal: controller.signal,
      headers: undefined,
      body: {
        modelId: "openai/gpt-4o-mini",
      },
      metadata: undefined,
    });

    controller.abort();
    await waitFor(() => abortCalls.length === 1);
    assert.deepEqual(abortCalls, ["chat-1"]);
  });
});

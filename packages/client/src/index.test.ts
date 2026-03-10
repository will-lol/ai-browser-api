import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { UIMessage } from "ai";
import {
  type BridgeAbortChatStreamRequest,
  type BridgeChatSendMessagesRequest,
  PageBridgeRpcGroup,
  RuntimeDefectError,
  RuntimeChatStreamNotFoundError,
  RuntimeValidationError,
  RuntimeUpstreamServiceError,
  isRuntimeRpcError,
  isPageBridgePortControlMessage,
  type RuntimeChatStreamChunk,
  type RuntimeStreamPart,
} from "@llm-bridge/contracts";
import { APICallError } from "@ai-sdk/provider";
import * as RpcServer from "@effect/rpc/RpcServer";
import type {
  FromClientEncoded,
  FromServerEncoded,
} from "@effect/rpc/RpcMessage";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Mailbox from "effect/Mailbox";
import * as Option from "effect/Option";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { BridgeClient, withBridgeClient } from "./index";

type TestGlobals = typeof globalThis & {
  MessageChannel: typeof MessageChannel;
  window?: Window & typeof globalThis;
  document?: Document;
};

type MockStreamScenario = {
  parts: Array<RuntimeStreamPart>;
  failAtRead?: number;
  error?: RuntimeUpstreamServiceError;
};

type MockChatStreamScenario = {
  chunks: Array<RuntimeChatStreamChunk>;
  failAtRead?: number;
  error?: RuntimeDefectError | RuntimeChatStreamNotFoundError;
};

const TEST_DESCRIPTOR = {
  specificationVersion: "v3" as const,
  provider: "bridge-test",
  modelId: "bridge-test-model",
  supportedUrls: {},
};

const BASE_STREAM_OPTIONS = {
  prompt: [
    {
      role: "user" as const,
      content: [{ type: "text" as const, text: "hello" }],
    },
  ],
};

const TEST_CHAT_MESSAGES: Array<UIMessage> = [
  {
    id: "msg_1",
    role: "user",
    parts: [
      {
        type: "text",
        text: "hello",
      },
    ],
  },
];

function createUpstreamError(message: string, retryAfter = 2) {
  return new RuntimeUpstreamServiceError({
    providerID: "google",
    operation: "stream",
    statusCode: 429,
    responseHeaders: {
      "retry-after": String(retryAfter),
    },
    retryable: true,
    message,
  });
}

function createRuntimeStream<T>(input: {
  parts: Array<T>;
  failAtRead?: number;
  error?: Error;
}) {
  let readCount = 0;
  let partIndex = 0;

  return new ReadableStream<T>({
    pull(controller) {
      if (input.failAtRead === readCount) {
        controller.error(input.error ?? createUpstreamError("stream failed"));
        return;
      }

      const next = input.parts[partIndex];
      if (next) {
        partIndex += 1;
        readCount += 1;
        controller.enqueue(next);
        return;
      }

      controller.close();
    },
  });
}

async function createMockPageBridgeSession(input: {
  port: MessagePort;
  streamScenarios: Array<MockStreamScenario>;
  chatSendScenarios?: Array<MockChatStreamScenario>;
  chatReconnectScenarios?: Array<MockChatStreamScenario>;
  chatSendRequests?: Array<BridgeChatSendMessagesRequest>;
  abortChatRequests?: Array<BridgeAbortChatStreamRequest>;
}) {
  const scope = await Effect.runPromise(Scope.make());
  let onMessage:
    | ((
        event: MessageEvent<FromClientEncoded | { _tag: string; type: string }>,
      ) => void)
    | undefined;
  let onMessageError: ((event: MessageEvent<unknown>) => void) | undefined;

  const handlersLayer = PageBridgeRpcGroup.toLayer(
    Effect.succeed(
      PageBridgeRpcGroup.of({
        listModels: () => Effect.succeed({ models: [] }),
        getModel: () => Effect.succeed(TEST_DESCRIPTOR),
        requestPermission: () =>
          Effect.fail(
            new RuntimeDefectError({
              defect: "requestPermission not expected in test",
            }),
          ),
        abort: () => Effect.succeed({ ok: true }),
        modelDoGenerate: () =>
          Effect.fail(
            new RuntimeDefectError({
              defect: "modelDoGenerate not expected in test",
            }),
          ),
        modelDoStream: () => {
          const scenario = input.streamScenarios.shift();
          if (!scenario) {
            return Stream.fail(
              new RuntimeDefectError({
                defect: "No stream scenario configured for test",
              }),
            );
          }

          return Stream.fromReadableStream(
            () => createRuntimeStream(scenario),
            (error) =>
              error instanceof RuntimeUpstreamServiceError
                ? error
                : new RuntimeDefectError({
                    defect: String(error),
                  }),
          );
        },
        chatSendMessages: (payload) => {
          input.chatSendRequests?.push(payload);
          const scenario = input.chatSendScenarios?.shift();
          if (!scenario) {
            return Stream.fail(
              new RuntimeDefectError({
                defect: "No chat send scenario configured for test",
              }),
            );
          }

          return Stream.fromReadableStream(
            () =>
              createRuntimeStream({
                parts: scenario.chunks,
                failAtRead: scenario.failAtRead,
                error: scenario.error,
              }),
            (error) =>
              isRuntimeRpcError(error)
                ? error
                : new RuntimeDefectError({
                    defect: String(error),
                  }),
          );
        },
        chatReconnectStream: () => {
          const scenario = input.chatReconnectScenarios?.shift();
          if (!scenario) {
            return Stream.fail(
              new RuntimeChatStreamNotFoundError({
                origin: "https://example.test",
                chatId: "missing",
                message: "No chat reconnect scenario configured for test",
              }),
            );
          }

          if (scenario.error instanceof RuntimeChatStreamNotFoundError) {
            return Stream.fail(scenario.error);
          }

          return Stream.fromReadableStream(
            () =>
              createRuntimeStream({
                parts: scenario.chunks,
                failAtRead: scenario.failAtRead,
                error: scenario.error,
              }),
            (error) =>
              isRuntimeRpcError(error)
                ? error
                : new RuntimeDefectError({
                    defect: String(error),
                  }),
          );
        },
        abortChatStream: (payload) =>
          Effect.sync(() => {
            input.abortChatRequests?.push(payload);
            return {
              ok: true,
            };
          }),
      }),
    ),
  );

  const protocol = await Effect.runPromise(
    RpcServer.Protocol.make((writeRequest) =>
      Effect.gen(function* () {
        const disconnects = yield* Mailbox.make<number>();
        const clientIds = new Set<number>([0]);

        onMessage = (event: MessageEvent<unknown>) => {
          if (isPageBridgePortControlMessage(event.data)) {
            void Effect.runPromise(disconnects.offer(0)).catch(() => undefined);
            return;
          }

          void Effect.runPromise(
            writeRequest(0, event.data as FromClientEncoded),
          ).catch(() => undefined);
        };

        onMessageError = () => {
          void Effect.runPromise(disconnects.offer(0)).catch(() => undefined);
        };

        input.port.addEventListener("message", onMessage);
        input.port.addEventListener("messageerror", onMessageError);
        input.port.start();

        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            if (onMessage) {
              input.port.removeEventListener("message", onMessage);
            }

            if (onMessageError) {
              input.port.removeEventListener("messageerror", onMessageError);
            }
          }),
        );

        return {
          disconnects,
          send: (_clientId: number, message: FromServerEncoded) =>
            Effect.sync(() => {
              input.port.postMessage(message);
            }),
          end: (_clientId: number) => Effect.void,
          clientIds: Effect.sync(() => new Set(clientIds)),
          initialMessage: Effect.succeed(Option.none()),
          supportsAck: true,
          supportsTransferables: false,
          supportsSpanPropagation: true,
        } as const;
      }),
    ).pipe(Scope.extend(scope)),
  );

  await Effect.runPromise(
    RpcServer.make(PageBridgeRpcGroup, {
      disableTracing: true,
      concurrency: "unbounded",
    }).pipe(
      Effect.provide(handlersLayer),
      Effect.provideService(RpcServer.Protocol, protocol),
      Effect.forkScoped,
      Scope.extend(scope),
    ),
  );

  return async () => {
    try {
      await Effect.runPromise(Scope.close(scope, Exit.succeed(undefined)));
    } finally {
      try {
        input.port.close();
      } catch {
        // ignored
      }
    }
  };
}

async function withMockBridge<A>(
  input: {
    streamScenarios: Array<MockStreamScenario>;
    chatSendScenarios?: Array<MockChatStreamScenario>;
    chatReconnectScenarios?: Array<MockChatStreamScenario>;
    chatSendRequests?: Array<BridgeChatSendMessagesRequest>;
    abortChatRequests?: Array<BridgeAbortChatStreamRequest>;
  },
  run: () => Promise<A>,
) {
  const globals = globalThis as TestGlobals;
  const originalWindow = globals.window;
  const originalDocument = globals.document;
  const sessionCleanups: Array<() => Promise<void>> = [];

  globals.document = {
    documentElement: {
      dataset: {
        llmBridgeReady: "true",
      },
    },
  } as unknown as Document;

  globals.window = {
    location: {
      origin: "https://example.test",
    } as Location,
    postMessage: (
      _message: unknown,
      _targetOrigin: string,
      transfer?: ReadonlyArray<Transferable>,
    ) => {
      if (!transfer?.[0] || !(transfer[0] instanceof MessagePort)) {
        throw new Error("Expected page bridge port transfer");
      }

      void createMockPageBridgeSession({
        port: transfer[0],
        streamScenarios: input.streamScenarios,
        chatSendScenarios: input.chatSendScenarios,
        chatReconnectScenarios: input.chatReconnectScenarios,
        chatSendRequests: input.chatSendRequests,
        abortChatRequests: input.abortChatRequests,
      }).then((cleanup) => {
        sessionCleanups.push(cleanup);
      });
    },
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  } as unknown as Window & typeof globalThis;

  try {
    return await run();
  } finally {
    while (sessionCleanups.length > 0) {
      const cleanup = sessionCleanups.pop();
      if (cleanup) {
        await cleanup();
      }
    }

    if (originalWindow === undefined) {
      Reflect.deleteProperty(globals, "window");
    } else {
      globals.window = originalWindow;
    }

    if (originalDocument === undefined) {
      Reflect.deleteProperty(globals, "document");
    } else {
      globals.document = originalDocument;
    }
  }
}

async function loadTestModel() {
  return await Effect.runPromise(
    withBridgeClient(
      Effect.gen(function* () {
        const client = yield* BridgeClient;
        return yield* client.getModel("google/gemini-test");
      }),
      {
        timeoutMs: 50,
      },
    ),
  );
}

async function loadTestChatTransport() {
  return await Effect.runPromise(
    withBridgeClient(
      Effect.gen(function* () {
        const client = yield* BridgeClient;
        return client.getChatTransport();
      }),
      {
        timeoutMs: 50,
      },
    ),
  );
}

async function readNextChunk<T>(reader: ReadableStreamDefaultReader<T>) {
  return await reader.read();
}

afterEach(() => {
  const globals = globalThis as TestGlobals;
  Reflect.deleteProperty(globals, "window");
  Reflect.deleteProperty(globals, "document");
});

describe("BridgeClientLive connection lifecycle", () => {
  it("recreates connection after a transient connect failure", async () => {
    const globals = globalThis as TestGlobals;
    const originalMessageChannel = globals.MessageChannel;
    let attempts = 0;

    globals.MessageChannel = class {
      constructor() {
        attempts += 1;
        throw new Error("forced connect failure");
      }
    } as unknown as typeof MessageChannel;

    try {
      await Effect.runPromise(
        withBridgeClient(
          Effect.gen(function* () {
            const client = yield* BridgeClient;
            const first = yield* Effect.either(client.listModels);
            const second = yield* Effect.either(client.listModels);

            assert.equal(first._tag, "Left");
            assert.equal(second._tag, "Left");
          }),
          {
            timeoutMs: 5,
          },
        ),
      );
    } finally {
      globals.MessageChannel = originalMessageChannel;
    }

    assert.equal(attempts, 2);
  });
});

describe("BridgeClientLive stream bootstrap", () => {
  it("fails doStream before returning when bootstrap metadata is followed by an upstream error", async () => {
    await withMockBridge(
      {
        streamScenarios: [
        {
          parts: [{ type: "stream-start", warnings: [] }],
          failAtRead: 1,
          error: createUpstreamError("Quota hit during bootstrap"),
        },
        ],
      },
      async () => {
        const model = await loadTestModel();

        await assert.rejects(
          () => Promise.resolve(model.doStream(BASE_STREAM_OPTIONS)),
          (error: unknown) => {
            assert.ok(error instanceof Error);
            assert.equal(APICallError.isInstance(error), true);
            assert.equal(error.message, "Quota hit during bootstrap");
            assert.equal(
              (error as APICallError).responseHeaders?.["retry-after"],
              "2",
            );
            return true;
          },
        );
      },
    );
  });

  it("buffers bootstrap metadata and replays it in order", async () => {
    await withMockBridge(
      {
        streamScenarios: [
        {
          parts: [
            { type: "stream-start", warnings: [] },
            {
              type: "response-metadata",
              id: "resp_1",
              modelId: "bridge-test-model",
            },
            { type: "text-start", id: "txt_1" },
            { type: "text-delta", id: "txt_1", delta: "hello" },
            { type: "text-end", id: "txt_1" },
            {
              type: "finish",
              finishReason: { unified: "stop", raw: "stop" },
              usage: {
                inputTokens: {
                  total: 1,
                },
                outputTokens: {
                  total: 1,
                },
              },
            },
          ],
        },
        ],
      },
      async () => {
        const model = await loadTestModel();
        const result = await model.doStream(BASE_STREAM_OPTIONS);
        const reader = result.stream.getReader();

        const first = await readNextChunk(reader);
        const second = await readNextChunk(reader);
        const third = await readNextChunk(reader);
        const fourth = await readNextChunk(reader);

        assert.equal(first.done, false);
        assert.equal(first.value?.type, "stream-start");
        assert.equal(second.done, false);
        assert.equal(second.value?.type, "response-metadata");
        assert.equal(third.done, false);
        assert.equal(third.value?.type, "text-start");
        assert.equal(fourth.done, false);
        assert.equal(fourth.value?.type, "text-delta");
        assert.equal(fourth.value?.delta, "hello");
      },
    );
  });

  it("surfaces later stream failures after the first content chunk", async () => {
    await withMockBridge(
      {
        streamScenarios: [
        {
          parts: [
            { type: "stream-start", warnings: [] },
            { type: "text-start", id: "txt_2" },
          ],
          failAtRead: 2,
          error: createUpstreamError("Late stream failure", 4),
        },
        ],
      },
      async () => {
        const model = await loadTestModel();
        const result = await model.doStream(BASE_STREAM_OPTIONS);
        const reader = result.stream.getReader();

        const first = await readNextChunk(reader);
        const second = await readNextChunk(reader);

        assert.equal(first.done, false);
        assert.equal(first.value?.type, "stream-start");
        assert.equal(second.done, false);
        assert.equal(second.value?.type, "text-start");

        await assert.rejects(
          readNextChunk(reader),
          (error: unknown) => {
            assert.ok(error instanceof Error);
            assert.equal(APICallError.isInstance(error), true);
            assert.equal(error.message, "Late stream failure");
            assert.equal(
              (error as APICallError).responseHeaders?.["retry-after"],
              "4",
            );
            return true;
          },
        );
      },
    );
  });
});

describe("BridgeClientLive chat transport", () => {
  it("returns a chat transport that streams UI message chunks", async () => {
    const chatSendRequests: Array<BridgeChatSendMessagesRequest> = [];

    await withMockBridge(
      {
        streamScenarios: [],
        chatSendScenarios: [
          {
            chunks: [
              { type: "start", messageId: "msg_assistant" },
              { type: "start-step" },
              { type: "text-start", id: "text_1" },
              { type: "text-delta", id: "text_1", delta: "hello" },
              { type: "text-end", id: "text_1" },
              { type: "finish-step" },
              { type: "finish" },
            ],
          },
        ],
        chatSendRequests,
      },
      async () => {
        const transport = await loadTestChatTransport();
        const stream = await transport.sendMessages({
          trigger: "submit-message",
          chatId: "chat_1",
          messageId: undefined,
          messages: TEST_CHAT_MESSAGES,
          abortSignal: undefined,
          body: {
            modelId: "google/gemini-test",
          },
        });

        const reader = stream.getReader();
        const first = await readNextChunk(reader);
        const second = await readNextChunk(reader);
        const third = await readNextChunk(reader);
        const fourth = await readNextChunk(reader);

        assert.equal(first.done, false);
        assert.equal(first.value?.type, "start");
        assert.equal(second.done, false);
        assert.equal(second.value?.type, "start-step");
        assert.equal(third.done, false);
        assert.equal(third.value?.type, "text-start");
        assert.equal(fourth.done, false);
        assert.equal(fourth.value?.type, "text-delta");
        assert.equal(fourth.value?.delta, "hello");
        assert.deepEqual(chatSendRequests, [
          {
            chatId: "chat_1",
            modelId: "google/gemini-test",
            trigger: "submit-message",
            messageId: undefined,
            messages: TEST_CHAT_MESSAGES,
            options: undefined,
          },
        ]);
      },
    );
  });

  it("supports switching models with the same transport instance", async () => {
    const chatSendRequests: Array<BridgeChatSendMessagesRequest> = [];

    await withMockBridge(
      {
        streamScenarios: [],
        chatSendScenarios: [
          {
            chunks: [{ type: "finish" }],
          },
          {
            chunks: [{ type: "finish" }],
          },
        ],
        chatSendRequests,
      },
      async () => {
        const transport = await loadTestChatTransport();

        const firstStream = await transport.sendMessages({
          trigger: "submit-message",
          chatId: "chat_switch",
          messageId: undefined,
          messages: TEST_CHAT_MESSAGES,
          abortSignal: undefined,
          body: {
            modelId: "google/gemini-test",
          },
        });
        await firstStream.getReader().read();

        const secondStream = await transport.sendMessages({
          trigger: "submit-message",
          chatId: "chat_switch",
          messageId: undefined,
          messages: TEST_CHAT_MESSAGES,
          abortSignal: undefined,
          body: {
            modelId: "openai/gpt-4o-mini",
          },
        });
        await secondStream.getReader().read();

        assert.deepEqual(
          chatSendRequests.map((request) => request.modelId),
          ["google/gemini-test", "openai/gpt-4o-mini"],
        );
      },
    );
  });

  it("fails when modelId is missing from the request body", async () => {
    const transport = await loadTestChatTransport();

    await assert.rejects(
      () =>
        transport.sendMessages({
          trigger: "submit-message",
          chatId: "chat_missing_model",
          messageId: undefined,
          messages: TEST_CHAT_MESSAGES,
          abortSignal: undefined,
          body: {},
        }),
      (error: Error) => {
        assert.equal(error instanceof RuntimeValidationError, true);
        assert.match(error.message, /body\.modelId/i);
        return true;
      },
    );
  });

  it("passes sanitized request body to prepareSendMessages", async () => {
    const prepared: Array<{
      modelId: string;
      body: object | undefined;
    }> = [];

    await withMockBridge(
      {
        streamScenarios: [],
        chatSendScenarios: [
          {
            chunks: [{ type: "finish" }],
          },
        ],
      },
      async () => {
        const transport = await Effect.runPromise(
          withBridgeClient(
            Effect.gen(function* () {
              const client = yield* BridgeClient;
              return client.getChatTransport({
                prepareSendMessages: ({ body, modelId }) => {
                  prepared.push({
                    modelId,
                    body,
                  });
                  return undefined;
                },
              });
            }),
            {
              timeoutMs: 50,
            },
          ),
        );

        const stream = await transport.sendMessages({
          trigger: "submit-message",
          chatId: "chat_prepare",
          messageId: undefined,
          messages: TEST_CHAT_MESSAGES,
          abortSignal: undefined,
          body: {
            modelId: "google/gemini-test",
            custom: "value",
          },
        });

        await stream.getReader().read();

        assert.deepEqual(prepared, [
          {
            modelId: "google/gemini-test",
            body: {
              custom: "value",
            },
          },
        ]);
      },
    );
  });

  it("maps reconnect misses to null", async () => {
    await withMockBridge(
      {
        streamScenarios: [],
        chatReconnectScenarios: [
          {
            chunks: [],
            failAtRead: 0,
            error: new RuntimeChatStreamNotFoundError({
              origin: "https://example.test",
              chatId: "chat_missing",
              message: "missing",
            }),
          },
        ],
      },
      async () => {
        const transport = await loadTestChatTransport();
        const result = await transport.reconnectToStream({
          chatId: "chat_missing",
        });

        assert.equal(result, null);
      },
    );
  });

  it("rejects per-request headers", async () => {
    const transport = await loadTestChatTransport();

    await assert.rejects(
      () =>
        transport.sendMessages({
          trigger: "submit-message",
          chatId: "chat_headers",
          messageId: undefined,
          messages: TEST_CHAT_MESSAGES,
          abortSignal: undefined,
          body: {
            modelId: "google/gemini-test",
          },
          headers: {
            "x-test": "1",
          },
        }),
      (error: Error) => {
        assert.equal(error instanceof RuntimeValidationError, true);
        assert.match(error.message, /does not support per-request headers/i);
        return true;
      },
    );
  });

  it("aborts by chatId when the request signal is aborted", async () => {
    const abortChatRequests: Array<BridgeAbortChatStreamRequest> = [];

    await withMockBridge(
      {
        streamScenarios: [],
        chatSendScenarios: [
          {
            chunks: [{ type: "start", messageId: "msg_assistant" }],
          },
        ],
        abortChatRequests,
      },
      async () => {
        const transport = await loadTestChatTransport();
        const abortController = new AbortController();

        await transport.sendMessages({
          trigger: "submit-message",
          chatId: "chat_abort",
          messageId: undefined,
          messages: TEST_CHAT_MESSAGES,
          abortSignal: abortController.signal,
          body: {
            modelId: "google/gemini-test",
          },
        });

        abortController.abort();
        await new Promise((resolve) => setTimeout(resolve, 0));

        assert.deepEqual(abortChatRequests, [
          {
            chatId: "chat_abort",
          },
        ]);
      },
    );
  });
});

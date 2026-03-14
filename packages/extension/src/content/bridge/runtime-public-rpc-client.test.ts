import assert from "node:assert/strict";
import { beforeEach, describe, it, mock } from "bun:test";
import type {
  RuntimePublicRpc,
  RuntimeValidationError,
} from "@llm-bridge/contracts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import type { RuntimeRpcClientConnection } from "@/shared/rpc/runtime-rpc-client-core";

let ensureClient: Effect.Effect<
  RuntimeRpcClientConnection<RuntimePublicRpc>,
  RuntimeValidationError
>;

mock.module("@/shared/rpc/runtime-rpc-client-core", () => ({
  makeRuntimeRpcClientCore: () => ({
    get ensureClient() {
      return ensureClient;
    },
  }),
}));

const { getRuntimePublicRPC } = await import("./runtime-public-rpc-client");

function createPublicClient(overrides?: {
  readonly listModels?: (
    payload: Record<string, unknown>,
  ) => Effect.Effect<
    ReadonlyArray<{
      readonly id: string;
      readonly name: string;
      readonly connected: boolean;
      readonly provider: string;
      readonly capabilities: ReadonlyArray<string>;
    }>
  >;
  readonly chatReconnectStream?: (
    payload: Record<string, unknown>,
  ) => Stream.Stream<Record<string, unknown>>;
}) {
  return {
    listModels:
      overrides?.listModels ??
      (() =>
        Effect.succeed([
          {
            id: "model-default",
            name: "Model Default",
            connected: true,
            provider: "provider-default",
            capabilities: [],
          },
        ])),
    getOriginState: () => Effect.die("unused"),
    listPending: () => Effect.die("unused"),
    acquireModel: () => Effect.die("unused"),
    modelDoGenerate: () => Effect.die("unused"),
    modelDoStream: () => Stream.empty,
    abortModelCall: () => Effect.void,
    chatSendMessages: () => Stream.empty,
    chatReconnectStream:
      overrides?.chatReconnectStream ??
      (() => Stream.make({ type: "chunk", value: "default" })),
    abortChatStream: () => Effect.void,
    createPermissionRequest: () => Effect.die("unused"),
  } as unknown as RuntimeRpcClientConnection<RuntimePublicRpc>;
}

beforeEach(() => {
  ensureClient = Effect.succeed(createPublicClient());
});

describe("getRuntimePublicRPC", () => {
  it("does not expose admin-only methods", () => {
    const runtime = getRuntimePublicRPC();

    assert.equal("streamProviders" in runtime, false);
    assert.equal("openProviderAuthWindow" in runtime, false);
    assert.equal(typeof runtime.chatReconnectStream, "function");
  });

  it("forwards unary and stream methods through the shared facade binder", async () => {
    const listModelsCalls: Array<Record<string, unknown>> = [];
    const chatReconnectStreamCalls: Array<Record<string, unknown>> = [];

    ensureClient = Effect.succeed(
      createPublicClient({
        listModels: (payload) =>
          Effect.sync(() => {
            listModelsCalls.push(payload);
            return [
              {
                id: "model-a",
                name: "Model A",
                connected: true,
                provider: "provider-a",
                capabilities: [],
              },
            ];
          }),
        chatReconnectStream: (payload) =>
          Stream.sync(() => {
            chatReconnectStreamCalls.push(payload);
            return {
              type: "chunk",
              value: "chunk-a",
            };
          }),
      }),
    );

    const runtime = getRuntimePublicRPC();
    const models = await Effect.runPromise(runtime.listModels({}));
    const streamed = await Effect.runPromise(
      Stream.runCollect(
        runtime.chatReconnectStream({
          chatId: "chat-1",
          origin: "https://example.com",
        }),
      ),
    );

    assert.deepEqual(models, [
      {
        id: "model-a",
        name: "Model A",
        connected: true,
        provider: "provider-a",
        capabilities: [],
      },
    ]);
    assert.deepEqual(Array.from(streamed), [
      {
        type: "chunk",
        value: "chunk-a",
      },
    ]);
    assert.deepEqual(listModelsCalls, [{}]);
    assert.deepEqual(chatReconnectStreamCalls, [
      {
        chatId: "chat-1",
        origin: "https://example.com",
      },
    ]);
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type RuntimeAdminRpc,
  type RuntimeModelSummary,
  type RuntimePublicRpc,
  type RuntimeStreamPart,
} from "@llm-bridge/contracts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import type { RuntimeRpcClientConnection } from "./runtime-rpc-client-core";
import { createRuntimeAdminRpcClient } from "./runtime-rpc-client";
import { createRuntimePublicRpcClient } from "./runtime-public-rpc-client";

const TEST_MODELS: ReadonlyArray<RuntimeModelSummary> = [
  {
    id: "openai/gpt-4o-mini",
    name: "GPT-4o mini",
    provider: "openai",
    capabilities: ["text"],
    connected: true,
  },
];

const TEST_STREAM_CHUNKS: ReadonlyArray<RuntimeStreamPart> = [
  {
    type: "text-delta",
    id: "txt_1",
    delta: "hello",
  },
  {
    type: "finish",
    finishReason: {
      unified: "stop",
    },
    usage: {
      inputTokens: {},
      outputTokens: {},
    },
  },
];

describe("runtime rpc client facade", () => {
  it("wraps public unary methods as effects", async () => {
    const client = createRuntimePublicRpcClient({
      ensureClient: Effect.succeed(
        ({
          listModels: () => Effect.succeed(TEST_MODELS),
        }) as unknown as RuntimeRpcClientConnection<RuntimePublicRpc>,
      ),
    });

    const effect = client.listModels({
      origin: "https://example.test",
      connectedOnly: true,
    });

    assert.deepEqual(await Effect.runPromise(effect), TEST_MODELS);
  });

  it("wraps public stream methods as streams", async () => {
    const client = createRuntimePublicRpcClient({
      ensureClient: Effect.succeed(
        ({
          modelDoStream: () => Stream.fromIterable(TEST_STREAM_CHUNKS),
        }) as unknown as RuntimeRpcClientConnection<RuntimePublicRpc>,
      ),
    });

    const stream = client.modelDoStream({
      origin: "https://example.test",
      requestId: "req_1",
      sessionID: "session_1",
      modelId: "openai/gpt-4o-mini",
      options: {
        prompt: [],
      },
    });

    const chunks = await Effect.runPromise(Stream.runCollect(stream));

    assert.deepEqual(Array.from(chunks), TEST_STREAM_CHUNKS);
  });

  it("wraps admin unary and stream methods using the explicit client", async () => {
    const client = createRuntimeAdminRpcClient({
      ensureClient: Effect.succeed(
        ({
          listProviders: () =>
            Effect.succeed([
              {
                id: "openai",
                name: "OpenAI",
                connected: true,
                env: ["OPENAI_API_KEY"],
                modelCount: 1,
              },
            ]),
          modelDoStream: () => Stream.fromIterable(TEST_STREAM_CHUNKS),
        }) as unknown as RuntimeRpcClientConnection<RuntimeAdminRpc>,
      ),
    });

    const providers = await Effect.runPromise(client.listProviders({}));
    const streamChunks = await Effect.runPromise(
      Stream.runCollect(
        client.modelDoStream({
          origin: "https://example.test",
          requestId: "req_2",
          sessionID: "session_2",
          modelId: "openai/gpt-4o-mini",
          options: {
            prompt: [],
          },
        }),
      ),
    );

    assert.deepEqual(providers, [
      {
        id: "openai",
        name: "OpenAI",
        connected: true,
        env: ["OPENAI_API_KEY"],
        modelCount: 1,
      },
    ]);
    assert.deepEqual(Array.from(streamChunks), TEST_STREAM_CHUNKS);
  });
});

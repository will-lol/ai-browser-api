import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  RuntimeAdminRpcGroup,
  RuntimePublicRpcGroup,
  type RuntimeAdminRpc,
  type RuntimeModelSummary,
  type RuntimePublicRpc,
  type RuntimeStreamPart,
} from "@llm-bridge/contracts"
import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"
import type { RuntimeConnection } from "./runtime-rpc-client-core"
import { createRuntimeRpcFacade } from "./runtime-rpc-client-factory"

const TEST_MODELS: ReadonlyArray<RuntimeModelSummary> = [
  {
    id: "openai/gpt-4o-mini",
    name: "GPT-4o mini",
    provider: "openai",
    capabilities: ["text"],
    connected: true,
  },
]

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
]

describe("runtime rpc client facade", () => {
  it("wraps public unary methods as promises", async () => {
    const facade = createRuntimeRpcFacade<RuntimePublicRpc>({
      ensureConnection: async () =>
        ({
          client: {
            listModels: () => Effect.succeed(TEST_MODELS),
          },
        }) as unknown as RuntimeConnection<RuntimePublicRpc>,
      rpcGroup: RuntimePublicRpcGroup,
    })

    const promise = facade.listModels({
      origin: "https://example.test",
      connectedOnly: true,
    })

    assert.ok(promise instanceof Promise)
    assert.deepEqual(await promise, TEST_MODELS)
  })

  it("wraps public stream methods as async iterables", async () => {
    const facade = createRuntimeRpcFacade<RuntimePublicRpc>({
      ensureConnection: async () =>
        ({
          client: {
            modelDoStream: () => Stream.fromIterable(TEST_STREAM_CHUNKS),
          },
        }) as unknown as RuntimeConnection<RuntimePublicRpc>,
      rpcGroup: RuntimePublicRpcGroup,
    })

    const iterable = facade.modelDoStream({
      origin: "https://example.test",
      requestId: "req_1",
      sessionID: "session_1",
      modelId: "openai/gpt-4o-mini",
      options: {
        prompt: [],
      },
    })

    const chunks: RuntimeStreamPart[] = []
    for await (const chunk of iterable) {
      chunks.push(chunk)
    }

    assert.deepEqual(chunks, TEST_STREAM_CHUNKS)
  })

  it("wraps admin unary and stream methods using the same generated factory", async () => {
    const facade = createRuntimeRpcFacade<RuntimeAdminRpc>({
      ensureConnection: async () =>
        ({
          client: {
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
          },
        }) as unknown as RuntimeConnection<RuntimeAdminRpc>,
      rpcGroup: RuntimeAdminRpcGroup,
    })

    const providers = await facade.listProviders({})
    const streamChunks: RuntimeStreamPart[] = []

    for await (const chunk of facade.modelDoStream({
      origin: "https://example.test",
      requestId: "req_2",
      sessionID: "session_2",
      modelId: "openai/gpt-4o-mini",
      options: {
        prompt: [],
      },
    })) {
      streamChunks.push(chunk)
    }

    assert.deepEqual(providers, [{
      id: "openai",
      name: "OpenAI",
      connected: true,
      env: ["OPENAI_API_KEY"],
      modelCount: 1,
    }])
    assert.deepEqual(streamChunks, TEST_STREAM_CHUNKS)
  })
})

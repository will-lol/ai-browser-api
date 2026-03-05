import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { anthropicPlugin } from "@/lib/runtime/plugins/anthropic"
import { googlePlugin } from "@/lib/runtime/plugins/google"
import { openaiPlugin } from "@/lib/runtime/plugins/openai"
import {
  type ChatTransformContext,
  PluginManager,
  type RuntimeAdapterContext,
  type RuntimeAdapterState,
  type RuntimeAdapterValidationState,
  type RuntimePlugin,
} from "@/lib/runtime/plugin-manager"

function createAdapterContext(): RuntimeAdapterContext {
  return {
    providerID: "google",
    modelID: "gemini-2.5-pro",
    origin: "https://example.test",
    sessionID: "session-1",
    requestID: "request-1",
    provider: {
      id: "google",
      name: "Google",
      source: "models.dev",
      env: ["GOOGLE_API_KEY"],
      connected: true,
      options: {},
    },
    model: {
      id: "gemini-2.5-pro",
      providerID: "google",
      name: "Gemini 2.5 Pro",
      status: "active",
      api: {
        id: "gemini-2.5-pro",
        url: "https://generativelanguage.googleapis.com",
        npm: "@ai-sdk/google",
      },
      cost: {
        input: 0,
        output: 0,
        cache: {
          read: 0,
          write: 0,
        },
      },
      limit: {
        context: 1,
        output: 1,
      },
      options: {},
      headers: {},
      capabilities: {
        temperature: true,
        reasoning: true,
        attachment: true,
        toolcall: true,
        input: {
          text: true,
          audio: false,
          image: true,
          video: false,
          pdf: true,
        },
        output: {
          text: true,
          audio: false,
          image: false,
          video: false,
          pdf: false,
        },
      },
    },
  }
}

function createAdapterState(): RuntimeAdapterState {
  return {
    factory: {
      npm: "@ai-sdk/google",
      factory: (() => {
        throw new Error("not used in unit test")
      }) as RuntimeAdapterState["factory"]["factory"],
    },
    transport: {
      authType: "api-key",
      apiKey: "token-1",
      baseURL: "https://example.test/v1",
      headers: {
        "x-base": "1",
      },
      metadata: {
        nested: {
          base: true,
        },
      },
    },
    cacheKeyParts: {
      base: true,
      nested: {
        fromBase: true,
      },
    },
  }
}

function createChatContext(input: {
  providerID: string
  modelID: string
}): ChatTransformContext {
  return {
    providerID: input.providerID,
    modelID: input.modelID,
    origin: "https://example.test",
    sessionID: "session-1",
    requestID: "request-1",
  }
}

describe("PluginManager adapter hooks", () => {
  it("chains adapter state patches deterministically", async () => {
    const plugins: RuntimePlugin[] = [
      {
        id: "plugin-a",
        name: "Plugin A",
        supportedProviders: ["google"],
        hooks: {
          adapter: {
            async patchTransport() {
              return {
                baseURL: "https://example.test/v2",
                headers: {
                  "x-a": "a",
                  "x-override": "a",
                },
                metadata: {
                  nested: {
                    fromA: true,
                  },
                },
              }
            },
            async cacheKeyParts() {
              return {
                nested: {
                  fromA: true,
                },
              }
            },
          },
        },
      },
      {
        id: "plugin-b",
        name: "Plugin B",
        supportedProviders: ["google"],
        hooks: {
          adapter: {
            async patchTransport() {
              return {
                authType: "bearer",
                headers: {
                  "x-b": "b",
                  "x-override": "b",
                },
                metadata: {
                  nested: {
                    fromB: true,
                  },
                },
              }
            },
            async cacheKeyParts() {
              return {
                scalar: "plugin-b",
                nested: {
                  fromB: true,
                },
              }
            },
          },
        },
      },
    ]

    const manager = new PluginManager(plugins)
    const next = await manager.applyAdapterState(createAdapterContext(), createAdapterState())

    assert.equal(next.transport.baseURL, "https://example.test/v2")
    assert.equal(next.transport.authType, "bearer")
    assert.deepEqual(next.transport.headers, {
      "x-base": "1",
      "x-a": "a",
      "x-b": "b",
      "x-override": "b",
    })
    assert.deepEqual(next.transport.metadata, {
      nested: {
        base: true,
        fromA: true,
        fromB: true,
      },
    })
    assert.deepEqual(next.cacheKeyParts, {
      base: true,
      scalar: "plugin-b",
      nested: {
        fromBase: true,
        fromA: true,
        fromB: true,
      },
    })
  })

  it("merges factory options with last-writer scalar semantics", async () => {
    const plugins: RuntimePlugin[] = [
      {
        id: "plugin-a",
        name: "Plugin A",
        supportedProviders: ["google"],
        hooks: {
          adapter: {
            async patchFactoryOptions() {
              return {
                nested: {
                  a: 1,
                  shared: "a",
                },
                scalar: "a",
              }
            },
          },
        },
      },
      {
        id: "plugin-b",
        name: "Plugin B",
        supportedProviders: ["google"],
        hooks: {
          adapter: {
            async patchFactoryOptions() {
              return {
                nested: {
                  b: 2,
                  shared: "b",
                },
                scalar: "b",
              }
            },
          },
        },
      },
    ]

    const manager = new PluginManager(plugins)
    const options = await manager.applyAdapterFactoryOptions(createAdapterContext(), {
      nested: {
        base: true,
      },
      scalar: "base",
    })

    assert.deepEqual(options, {
      nested: {
        base: true,
        a: 1,
        b: 2,
        shared: "b",
      },
      scalar: "b",
    })
  })

  it("propagates adapter validation failures", async () => {
    const plugins: RuntimePlugin[] = [
      {
        id: "plugin-a",
        name: "Plugin A",
        supportedProviders: ["google"],
        hooks: {
          adapter: {
            async validate() {
              throw new Error("adapter validation failed")
            },
          },
        },
      },
    ]

    const manager = new PluginManager(plugins)
    const state: RuntimeAdapterValidationState = {
      ...createAdapterState(),
      factoryOptions: {},
    }

    await assert.rejects(
      () => manager.validateAdapterState(createAdapterContext(), state),
      /adapter validation failed/,
    )
  })
})

describe("PluginManager request options", () => {
  it("does not inject implicit provider defaults for google, anthropic, or openai", async () => {
    const manager = new PluginManager([googlePlugin, anthropicPlugin, openaiPlugin])

    const googleOptions = {
      model: "gemini-2.0-flash",
    }
    const anthropicOptions = {
      model: "claude-3-5-sonnet-20241022",
    }
    const openaiOptions = {
      model: "gpt-5",
    }

    assert.deepEqual(
      await manager.applyRequestOptions(createChatContext({ providerID: "google", modelID: "gemini-2.0-flash" }), googleOptions),
      googleOptions,
    )
    assert.deepEqual(
      await manager.applyRequestOptions(
        createChatContext({ providerID: "anthropic", modelID: "claude-3-5-sonnet-20241022" }),
        anthropicOptions,
      ),
      anthropicOptions,
    )
    assert.deepEqual(
      await manager.applyRequestOptions(createChatContext({ providerID: "openai", modelID: "gpt-5" }), openaiOptions),
      openaiOptions,
    )
  })

  it("preserves explicit caller request options", async () => {
    const manager = new PluginManager([googlePlugin, anthropicPlugin, openaiPlugin])
    const googleOptions = {
      model: "gemini-2.0-flash",
      thinkingConfig: {
        includeThoughts: false,
      },
    }
    const anthropicOptions = {
      model: "claude-3-5-sonnet-20241022",
      thinking: {
        type: "disabled",
      },
    }
    const openaiOptions = {
      model: "gpt-5",
      store: true,
      reasoning: {
        effort: "high",
      },
    }

    assert.deepEqual(
      await manager.applyRequestOptions(createChatContext({ providerID: "google", modelID: "gemini-2.0-flash" }), googleOptions),
      googleOptions,
    )
    assert.deepEqual(
      await manager.applyRequestOptions(
        createChatContext({ providerID: "anthropic", modelID: "claude-3-5-sonnet-20241022" }),
        anthropicOptions,
      ),
      anthropicOptions,
    )
    assert.deepEqual(
      await manager.applyRequestOptions(createChatContext({ providerID: "openai", modelID: "gpt-5" }), openaiOptions),
      openaiOptions,
    )
  })
})

import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
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

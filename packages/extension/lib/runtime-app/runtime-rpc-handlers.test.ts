import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  RuntimeValidationError,
  type RuntimeModelSummary,
} from "@llm-bridge/contracts"
import {
  RuntimeApplication,
  type RuntimeApplicationApi,
} from "@llm-bridge/runtime-core"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import {
  makeRuntimeAdminRpcHandlers,
  makeRuntimePublicRpcHandlers,
} from "./runtime-rpc-handlers"

const TEST_ORIGIN = "https://example.test"
const TEST_MODEL_ID = "openai/gpt-4o-mini"
const TEST_MODELS: ReadonlyArray<RuntimeModelSummary> = [
  {
    id: TEST_MODEL_ID,
    name: "GPT-4o mini",
    provider: "openai",
    capabilities: ["text"],
    connected: true,
  },
]

type Trace = {
  ensureOriginEnabled: string[]
  listModels: Array<{
    origin: string
    connectedOnly?: boolean
    providerID?: string
  }>
  requestPermission: Array<{
    origin: string
    action: "create" | "resolve" | "dismiss"
  }>
}

function disabledOriginError(origin: string) {
  return new RuntimeValidationError({
    message: `Origin ${origin} is disabled`,
  })
}

function createRuntimeApplication(
  overrides?: (trace: Trace) => Partial<RuntimeApplicationApi>,
) {
  const trace: Trace = {
    ensureOriginEnabled: [],
    listModels: [],
    requestPermission: [],
  }

  const runtimeApplication = {
    startup: () => Effect.succeed(undefined),
    ensureOriginEnabled: (origin: string) =>
      Effect.sync(() => {
        trace.ensureOriginEnabled.push(origin)
      }),
    listProviders: (_origin: string) => Effect.succeed([]),
    listModels: (input: {
      origin: string
      connectedOnly?: boolean
      providerID?: string
    }) =>
      Effect.sync(() => {
        trace.listModels.push(input)
        return TEST_MODELS
      }),
    listConnectedModels: (_origin: string) => Effect.succeed(TEST_MODELS),
    getOriginState: (origin: string) =>
      Effect.succeed({
        origin,
        enabled: true,
      }),
    listPermissions: (_origin: string) => Effect.succeed([]),
    listPending: (_origin: string) => Effect.succeed([]),
    openProviderAuthWindow: (providerID: string) =>
      Effect.succeed({
        providerID,
        reused: false,
        windowId: 1,
      }),
    getProviderAuthFlow: (providerID: string) =>
      Effect.succeed({
        providerID,
        result: {
          providerID,
          status: "idle" as const,
          methods: [],
          updatedAt: 1,
          canCancel: false,
        },
      }),
    startProviderAuthFlow: (input: {
      providerID: string
      methodID: string
      values?: Record<string, string>
    }) =>
      Effect.succeed({
        providerID: input.providerID,
        result: {
          providerID: input.providerID,
          status: "idle" as const,
          methods: [],
          updatedAt: 1,
          canCancel: false,
        },
      }),
    cancelProviderAuthFlow: (input: {
      providerID: string
      reason?: string
    }) =>
      Effect.succeed({
        providerID: input.providerID,
        result: {
          providerID: input.providerID,
          status: "canceled" as const,
          methods: [],
          updatedAt: 1,
          canCancel: false,
        },
      }),
    disconnectProvider: (providerID: string) =>
      Effect.succeed({
        providerID,
        connected: false,
      }),
    updatePermission: (input) =>
      Effect.succeed(
        input.mode === "origin"
          ? {
            origin: input.origin,
            enabled: input.enabled,
          }
          : {
            origin: input.origin,
            modelId: input.modelId,
            status: input.status,
          },
      ),
    requestPermission: (input) =>
      Effect.sync(() => {
        trace.requestPermission.push({
          origin: input.origin,
          action: input.action,
        })

        switch (input.action) {
          case "create":
            return {
              status: "requested" as const,
              request: {
                id: "prm_1",
                origin: input.origin,
                modelId: input.modelId,
                modelName: "GPT-4o mini",
                provider: "openai",
                capabilities: ["text"],
                requestedAt: 1,
                dismissed: false,
                status: "pending" as const,
              },
            }
          case "resolve":
            return {
              requestId: input.requestId,
              decision: input.decision,
            }
          case "dismiss":
            return {
              requestId: input.requestId,
            }
        }
      }),
    acquireModel: (input) =>
      Effect.succeed({
        specificationVersion: "v3" as const,
        provider: "openai",
        modelId: input.modelID,
        supportedUrls: {},
      }),
    modelDoGenerate: () =>
      Effect.succeed({
        content: [],
        finishReason: { unified: "stop" as const },
        usage: { inputTokens: {}, outputTokens: {} },
        warnings: [],
      }),
    modelDoStream: () =>
      Effect.succeed(
        new ReadableStream({
          start(controller) {
            controller.close()
          },
        }),
      ),
    abortModelCall: () => Effect.succeed(undefined),
    ...overrides?.(trace),
  } satisfies RuntimeApplicationApi

  return {
    runtimeApplication,
    trace,
  }
}

async function loadPublicHandlers(runtimeApplication: RuntimeApplicationApi) {
  return Effect.runPromise(
    makeRuntimePublicRpcHandlers.pipe(
      Effect.provide(Layer.succeed(RuntimeApplication, runtimeApplication)),
    ),
  )
}

async function loadAdminHandlers(runtimeApplication: RuntimeApplicationApi) {
  return Effect.runPromise(
    makeRuntimeAdminRpcHandlers.pipe(
      Effect.provide(Layer.succeed(RuntimeApplication, runtimeApplication)),
    ),
  )
}

describe("runtime rpc handlers", () => {
  it("blocks public listModels when the origin is disabled", async () => {
    const { runtimeApplication, trace } = createRuntimeApplication((currentTrace) => ({
      ensureOriginEnabled: (origin: string) =>
        Effect.sync(() => {
          currentTrace.ensureOriginEnabled.push(origin)
        }).pipe(
          Effect.flatMap(() => Effect.fail(disabledOriginError(origin))),
        ),
    }))

    const handlers = await loadPublicHandlers(runtimeApplication)

    await assert.rejects(
      Effect.runPromise(handlers.listModels({
        origin: TEST_ORIGIN,
        connectedOnly: true,
      })),
      new RegExp(`Origin ${TEST_ORIGIN} is disabled`),
    )

    assert.deepEqual(trace.ensureOriginEnabled, [TEST_ORIGIN])
    assert.equal(trace.listModels.length, 0)
  })

  it("delegates public listModels when the origin is enabled", async () => {
    const { runtimeApplication, trace } = createRuntimeApplication()
    const handlers = await loadPublicHandlers(runtimeApplication)

    const result = await Effect.runPromise(handlers.listModels({
      origin: TEST_ORIGIN,
      connectedOnly: true,
      providerID: "openai",
    }))

    assert.deepEqual(result, TEST_MODELS)
    assert.deepEqual(trace.ensureOriginEnabled, [TEST_ORIGIN])
    assert.deepEqual(trace.listModels, [{
      origin: TEST_ORIGIN,
      connectedOnly: true,
      providerID: "openai",
    }])
  })

  it("blocks public create requestPermission when the origin is disabled", async () => {
    const { runtimeApplication, trace } = createRuntimeApplication((currentTrace) => ({
      ensureOriginEnabled: (origin: string) =>
        Effect.sync(() => {
          currentTrace.ensureOriginEnabled.push(origin)
        }).pipe(
          Effect.flatMap(() => Effect.fail(disabledOriginError(origin))),
        ),
    }))

    const handlers = await loadPublicHandlers(runtimeApplication)

    await assert.rejects(
      Effect.runPromise(handlers.requestPermission({
        action: "create",
        origin: TEST_ORIGIN,
        modelId: TEST_MODEL_ID,
      })),
      new RegExp(`Origin ${TEST_ORIGIN} is disabled`),
    )

    assert.deepEqual(trace.ensureOriginEnabled, [TEST_ORIGIN])
    assert.equal(trace.requestPermission.length, 0)
  })

  it("delegates public create requestPermission and keeps create-response validation", async () => {
    const { runtimeApplication, trace } = createRuntimeApplication()
    const handlers = await loadPublicHandlers(runtimeApplication)

    const result = await Effect.runPromise(handlers.requestPermission({
      action: "create",
      origin: TEST_ORIGIN,
      modelId: TEST_MODEL_ID,
    }))

    assert.equal(result.status, "requested")
    assert.deepEqual(trace.ensureOriginEnabled, [TEST_ORIGIN])
    assert.deepEqual(trace.requestPermission, [{
      origin: TEST_ORIGIN,
      action: "create",
    }])
  })

  it("rejects a non-create permission response on the public handler", async () => {
    const { runtimeApplication, trace } = createRuntimeApplication((currentTrace) => ({
      requestPermission: (input) =>
        Effect.sync(() => {
          currentTrace.requestPermission.push({
            origin: input.origin,
            action: input.action,
          })
          return {
            requestId: "prm_1",
          }
        }),
    }))

    const handlers = await loadPublicHandlers(runtimeApplication)

    await assert.rejects(
      Effect.runPromise(handlers.requestPermission({
        action: "create",
        origin: TEST_ORIGIN,
        modelId: TEST_MODEL_ID,
      })),
      /Unexpected permission response for create action/,
    )

    assert.deepEqual(trace.ensureOriginEnabled, [TEST_ORIGIN])
    assert.deepEqual(trace.requestPermission, [{
      origin: TEST_ORIGIN,
      action: "create",
    }])
  })

  it("allows admin listModels without the origin-enabled gate", async () => {
    const { runtimeApplication, trace } = createRuntimeApplication(() => ({
      ensureOriginEnabled: (origin: string) => Effect.fail(disabledOriginError(origin)),
    }))

    const handlers = await loadAdminHandlers(runtimeApplication)

    const result = await Effect.runPromise(handlers.listModels({
      origin: TEST_ORIGIN,
      connectedOnly: true,
    }))

    assert.deepEqual(result, TEST_MODELS)
    assert.equal(trace.ensureOriginEnabled.length, 0)
    assert.deepEqual(trace.listModels, [{
      origin: TEST_ORIGIN,
      connectedOnly: true,
      providerID: undefined,
    }])
  })

  it("allows admin resolve and dismiss requestPermission on a disabled site", async () => {
    const { runtimeApplication, trace } = createRuntimeApplication(() => ({
      ensureOriginEnabled: (origin: string) => Effect.fail(disabledOriginError(origin)),
    }))

    const handlers = await loadAdminHandlers(runtimeApplication)

    const resolved = await Effect.runPromise(handlers.requestPermission({
      action: "resolve",
      origin: TEST_ORIGIN,
      requestId: "prm_1",
      decision: "allowed",
    }))
    const dismissed = await Effect.runPromise(handlers.requestPermission({
      action: "dismiss",
      origin: TEST_ORIGIN,
      requestId: "prm_2",
    }))

    assert.deepEqual(resolved, {
      requestId: "prm_1",
      decision: "allowed",
    })
    assert.deepEqual(dismissed, {
      requestId: "prm_2",
    })
    assert.equal(trace.ensureOriginEnabled.length, 0)
    assert.deepEqual(trace.requestPermission, [
      {
        origin: TEST_ORIGIN,
        action: "resolve",
      },
      {
        origin: TEST_ORIGIN,
        action: "dismiss",
      },
    ])
  })
})

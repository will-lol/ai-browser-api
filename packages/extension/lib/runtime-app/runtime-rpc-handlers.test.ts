import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  RuntimeAuthProviderError,
  RuntimeUpstreamServiceError,
  RuntimeValidationError,
  type RuntimeModelSummary,
} from "@llm-bridge/contracts";
import {
  RuntimeApplication,
  type RuntimeApplicationApi,
} from "@llm-bridge/runtime-core";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  makeRuntimeAdminRpcHandlers,
  makeRuntimePublicRpcHandlers,
} from "./runtime-rpc-handlers";

const TEST_ORIGIN = "https://example.test";
const TEST_MODEL_ID = "openai/gpt-4o-mini";
const TEST_MODELS: ReadonlyArray<RuntimeModelSummary> = [
  {
    id: TEST_MODEL_ID,
    name: "GPT-4o mini",
    provider: "openai",
    capabilities: ["text"],
    connected: true,
  },
];

type Trace = {
  ensureOriginEnabled: string[];
  listModels: Array<{
    origin?: string;
    connectedOnly?: boolean;
    providerID?: string;
  }>;
  acquireModel: Array<{
    origin: string;
    requestID: string;
    sessionID: string;
    modelID: string;
  }>;
  requestPermission: Array<{
    action: "create" | "resolve" | "dismiss";
    origin?: string;
    requestId?: string;
  }>;
  startProviderAuthFlow: Array<{
    providerID: string;
    methodID: string;
    values?: Record<string, string>;
  }>;
};

function disabledOriginError(origin: string) {
  return new RuntimeValidationError({
    message: `Origin ${origin} is disabled`,
  });
}

function createRuntimeApplication(
  overrides?: (trace: Trace) => Partial<RuntimeApplicationApi>,
) {
  const trace: Trace = {
    ensureOriginEnabled: [],
    listModels: [],
    acquireModel: [],
    requestPermission: [],
    startProviderAuthFlow: [],
  };

  const runtimeApplication = {
    startup: () => Effect.succeed(undefined),
    ensureOriginEnabled: (origin: string) =>
      Effect.sync(() => {
        trace.ensureOriginEnabled.push(origin);
      }),
    listProviders: () => Effect.succeed([]),
    listModels: (input: {
      origin?: string;
      connectedOnly?: boolean;
      providerID?: string;
    }) =>
      Effect.sync(() => {
        trace.listModels.push(input);
        return TEST_MODELS;
      }),
    listConnectedModels: () => Effect.succeed(TEST_MODELS),
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
      providerID: string;
      methodID: string;
      values?: Record<string, string>;
    }) =>
      Effect.sync(() => {
        trace.startProviderAuthFlow.push(
          input.values == null
            ? {
                providerID: input.providerID,
                methodID: input.methodID,
              }
            : {
                providerID: input.providerID,
                methodID: input.methodID,
                values: input.values,
              },
        );

        return {
          providerID: input.providerID,
          result: {
            providerID: input.providerID,
            status: "idle" as const,
            methods: [],
            updatedAt: 1,
            canCancel: false,
          },
        };
      }),
    cancelProviderAuthFlow: (input: { providerID: string; reason?: string }) =>
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
        switch (input.action) {
          case "create":
            trace.requestPermission.push({
              action: input.action,
              origin: input.origin,
            });
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
            };
          case "resolve":
            trace.requestPermission.push({
              action: input.action,
              requestId: input.requestId,
            });
            return {
              requestId: input.requestId,
              decision: input.decision,
            };
          case "dismiss":
            trace.requestPermission.push({
              action: input.action,
              requestId: input.requestId,
            });
            return {
              requestId: input.requestId,
            };
        }
      }),
    acquireModel: (input) =>
      Effect.sync(() => {
        trace.acquireModel.push(input);
        return {
          specificationVersion: "v3" as const,
          provider: "openai",
          modelId: input.modelID,
          supportedUrls: {},
        };
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
            controller.close();
          },
        }),
      ),
    abortModelCall: () => Effect.succeed(undefined),
    ...overrides?.(trace),
  } satisfies RuntimeApplicationApi;

  return {
    runtimeApplication,
    trace,
  };
}

async function loadPublicHandlers(runtimeApplication: RuntimeApplicationApi) {
  return Effect.runPromise(
    makeRuntimePublicRpcHandlers.pipe(
      Effect.provide(Layer.succeed(RuntimeApplication, runtimeApplication)),
    ),
  );
}

async function loadAdminHandlers(runtimeApplication: RuntimeApplicationApi) {
  return Effect.runPromise(
    makeRuntimeAdminRpcHandlers.pipe(
      Effect.provide(Layer.succeed(RuntimeApplication, runtimeApplication)),
    ),
  );
}

describe("runtime rpc handlers", () => {
  it("blocks public listModels when the origin is disabled", async () => {
    const { runtimeApplication, trace } = createRuntimeApplication(
      (currentTrace) => ({
        ensureOriginEnabled: (origin: string) =>
          Effect.sync(() => {
            currentTrace.ensureOriginEnabled.push(origin);
          }).pipe(
            Effect.flatMap(() => Effect.fail(disabledOriginError(origin))),
          ),
      }),
    );

    const handlers = await loadPublicHandlers(runtimeApplication);

    await assert.rejects(
      Effect.runPromise(
        handlers.listModels({
          origin: TEST_ORIGIN,
          connectedOnly: true,
        }),
      ),
      new RegExp(`Origin ${TEST_ORIGIN} is disabled`),
    );

    assert.deepEqual(trace.ensureOriginEnabled, [TEST_ORIGIN]);
    assert.equal(trace.listModels.length, 0);
  });

  it("delegates public listModels when the origin is enabled", async () => {
    const { runtimeApplication, trace } = createRuntimeApplication();
    const handlers = await loadPublicHandlers(runtimeApplication);

    const result = await Effect.runPromise(
      handlers.listModels({
        origin: TEST_ORIGIN,
        connectedOnly: true,
        providerID: "openai",
      }),
    );

    assert.deepEqual(result, TEST_MODELS);
    assert.deepEqual(trace.ensureOriginEnabled, [TEST_ORIGIN]);
    assert.deepEqual(trace.listModels, [
      {
        connectedOnly: true,
        providerID: "openai",
      },
    ]);
  });

  it("blocks public create requestPermission when the origin is disabled", async () => {
    const { runtimeApplication, trace } = createRuntimeApplication(
      (currentTrace) => ({
        ensureOriginEnabled: (origin: string) =>
          Effect.sync(() => {
            currentTrace.ensureOriginEnabled.push(origin);
          }).pipe(
            Effect.flatMap(() => Effect.fail(disabledOriginError(origin))),
          ),
      }),
    );

    const handlers = await loadPublicHandlers(runtimeApplication);

    await assert.rejects(
      Effect.runPromise(
        handlers.requestPermission({
          action: "create",
          origin: TEST_ORIGIN,
          modelId: TEST_MODEL_ID,
        }),
      ),
      new RegExp(`Origin ${TEST_ORIGIN} is disabled`),
    );

    assert.deepEqual(trace.ensureOriginEnabled, [TEST_ORIGIN]);
    assert.equal(trace.requestPermission.length, 0);
  });

  it("delegates public create requestPermission and keeps create-response validation", async () => {
    const { runtimeApplication, trace } = createRuntimeApplication();
    const handlers = await loadPublicHandlers(runtimeApplication);

    const result = await Effect.runPromise(
      handlers.requestPermission({
        action: "create",
        origin: TEST_ORIGIN,
        modelId: TEST_MODEL_ID,
      }),
    );

    assert.equal(result.status, "requested");
    assert.deepEqual(trace.ensureOriginEnabled, [TEST_ORIGIN]);
    assert.deepEqual(trace.requestPermission, [
      {
        origin: TEST_ORIGIN,
        action: "create",
      },
    ]);
  });

  it("rejects a non-create permission response on the public handler", async () => {
    const { runtimeApplication, trace } = createRuntimeApplication(
      (currentTrace) => ({
        requestPermission: (input) =>
          Effect.sync(() => {
            if (input.action === "create") {
              currentTrace.requestPermission.push({
                action: input.action,
                origin: input.origin,
              });
            }
            return {
              requestId: "prm_1",
            };
          }),
      }),
    );

    const handlers = await loadPublicHandlers(runtimeApplication);

    await assert.rejects(
      Effect.runPromise(
        handlers.requestPermission({
          action: "create",
          origin: TEST_ORIGIN,
          modelId: TEST_MODEL_ID,
        }),
      ),
      /Unexpected permission response for create action/,
    );

    assert.deepEqual(trace.ensureOriginEnabled, [TEST_ORIGIN]);
    assert.deepEqual(trace.requestPermission, [
      {
        origin: TEST_ORIGIN,
        action: "create",
      },
    ]);
  });

  it("allows admin listModels without the origin-enabled gate", async () => {
    const { runtimeApplication, trace } = createRuntimeApplication(() => ({
      ensureOriginEnabled: (origin: string) =>
        Effect.fail(disabledOriginError(origin)),
    }));

    const handlers = await loadAdminHandlers(runtimeApplication);

    const result = await Effect.runPromise(
      handlers.listModels({
        connectedOnly: true,
      }),
    );

    assert.deepEqual(result, TEST_MODELS);
    assert.equal(trace.ensureOriginEnabled.length, 0);
    assert.deepEqual(trace.listModels, [
      {
        connectedOnly: true,
        providerID: undefined,
      },
    ]);
  });

  it("keeps shared acquireModel behavior aligned across public and admin handlers", async () => {
    const publicRuntime = createRuntimeApplication();
    const adminRuntime = createRuntimeApplication();
    const publicHandlers = await loadPublicHandlers(
      publicRuntime.runtimeApplication,
    );
    const adminHandlers = await loadAdminHandlers(
      adminRuntime.runtimeApplication,
    );

    const request = {
      origin: TEST_ORIGIN,
      requestId: "req_1",
      sessionID: "session_1",
      modelId: TEST_MODEL_ID,
    } as const;

    const publicResult = await Effect.runPromise(
      publicHandlers.acquireModel(request),
    );
    const adminResult = await Effect.runPromise(
      adminHandlers.acquireModel(request),
    );

    assert.deepEqual(publicResult, adminResult);
    assert.deepEqual(publicRuntime.trace.acquireModel, [
      {
        origin: TEST_ORIGIN,
        requestID: "req_1",
        sessionID: "session_1",
        modelID: TEST_MODEL_ID,
      },
    ]);
    assert.deepEqual(adminRuntime.trace.acquireModel, [
      {
        origin: TEST_ORIGIN,
        requestID: "req_1",
        sessionID: "session_1",
        modelID: TEST_MODEL_ID,
      },
    ]);
  });

  it("delegates admin provider auth without origin in the payload shape", async () => {
    const { runtimeApplication, trace } = createRuntimeApplication();
    const handlers = await loadAdminHandlers(runtimeApplication);

    const result = await Effect.runPromise(
      handlers.startProviderAuthFlow({
        providerID: "openai",
        methodID: "api-key",
      }),
    );

    assert.equal(result.providerID, "openai");
    assert.deepEqual(trace.startProviderAuthFlow, [
      {
        providerID: "openai",
        methodID: "api-key",
      },
    ]);
  });

  it("preserves typed upstream errors from admin provider auth handlers", async () => {
    const { runtimeApplication } = createRuntimeApplication(() => ({
      startProviderAuthFlow: () =>
        Effect.fail(
          new RuntimeUpstreamServiceError({
            providerID: "openai",
            operation: "auth.authorize",
            statusCode: 429,
            retryAfter: 3,
            retryable: true,
            message: "Rate limited",
          }),
        ),
    }));

    const handlers = await loadAdminHandlers(runtimeApplication);

    const result = await Effect.runPromise(
      Effect.either(
        handlers.startProviderAuthFlow({
          providerID: "openai",
          methodID: "api-key",
        }),
      ),
    );

    assert.equal(result._tag, "Left");
    assert.ok(result.left instanceof RuntimeUpstreamServiceError);
    assert.equal(result.left.providerID, "openai");
    assert.equal(result.left.operation, "auth.authorize");
    assert.equal(result.left.retryAfter, 3);
    assert.equal(result.left.statusCode, 429);
  });

  it("preserves typed auth provider errors from admin provider auth handlers", async () => {
    const { runtimeApplication } = createRuntimeApplication(() => ({
      startProviderAuthFlow: () =>
        Effect.fail(
          new RuntimeAuthProviderError({
            providerID: "gitlab",
            operation: "auth.authorize",
            retryable: false,
            message: "Plugin rejected the request",
          }),
        ),
    }));

    const handlers = await loadAdminHandlers(runtimeApplication);

    const result = await Effect.runPromise(
      Effect.either(
        handlers.startProviderAuthFlow({
          providerID: "gitlab",
          methodID: "oauth",
        }),
      ),
    );

    assert.equal(result._tag, "Left");
    assert.ok(result.left instanceof RuntimeAuthProviderError);
    assert.equal(result.left.providerID, "gitlab");
    assert.equal(result.left.operation, "auth.authorize");
    assert.equal(result.left.message, "Plugin rejected the request");
  });

  it("allows admin resolve and dismiss requestPermission on a disabled site", async () => {
    const { runtimeApplication, trace } = createRuntimeApplication(() => ({
      ensureOriginEnabled: (origin: string) =>
        Effect.fail(disabledOriginError(origin)),
    }));

    const handlers = await loadAdminHandlers(runtimeApplication);

    const resolved = await Effect.runPromise(
      handlers.requestPermission({
        action: "resolve",
        requestId: "prm_1",
        decision: "allowed",
      }),
    );
    const dismissed = await Effect.runPromise(
      handlers.requestPermission({
        action: "dismiss",
        requestId: "prm_2",
      }),
    );

    assert.deepEqual(resolved, {
      requestId: "prm_1",
      decision: "allowed",
    });
    assert.deepEqual(dismissed, {
      requestId: "prm_2",
    });
    assert.equal(trace.ensureOriginEnabled.length, 0);
    assert.deepEqual(trace.requestPermission, [
      {
        action: "resolve",
        requestId: "prm_1",
      },
      {
        action: "dismiss",
        requestId: "prm_2",
      },
    ]);
  });
});

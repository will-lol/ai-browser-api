// @ts-expect-error bun:test types are not part of this package's TypeScript environment.
import { describe, expect, it } from "bun:test";
import {
  ModelNotFoundError,
  RuntimeValidationError,
} from "@llm-bridge/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type {
  MetaRepositoryApi,
  ModelExecutionRepositoryApi,
  PermissionsRepositoryApi,
} from "./repositories";
import {
  MetaRepository,
  ModelExecutionRepository,
  PermissionsRepository,
} from "./repositories";
import {
  ModelExecutionService,
  ModelExecutionServiceLive,
  PermissionServiceLive,
} from "./services";

const TEST_ORIGIN = "https://example.test";
const TEST_MODEL_ID = "provider/model";
const TEST_SESSION_ID = "session-1";
const TEST_REQUEST_ID = "request-1";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function createModelExecutionService(input: {
  waitBehavior: "resolved" | "signal-abort";
  postWaitPermission?: "allowed" | "denied";
}) {
  let permissionReads = 0;
  let generateCalls = 0;

  const permissionsRepo = {
    getOriginState: () =>
      Effect.succeed({
        origin: TEST_ORIGIN,
        enabled: true,
      }),
    listPermissions: () => Effect.succeed([]),
    getModelPermission: () =>
      Effect.sync(() => {
        permissionReads += 1;
        if (permissionReads === 1) return "denied";
        return input.postWaitPermission ?? "allowed";
      }),
    setOriginEnabled: (origin: string, enabled: boolean) =>
      Effect.succeed({
        origin,
        enabled,
      }),
    updatePermission: (payload: {
      origin: string;
      modelID: string;
      status: "allowed" | "denied";
      capabilities?: ReadonlyArray<string>;
    }) =>
      Effect.succeed({
        origin: payload.origin,
        modelId: payload.modelID,
        status: payload.status,
      }),
    createPermissionRequest: () =>
      Effect.succeed({
        status: "requested" as const,
        request: {
          id: "prm-test",
          origin: TEST_ORIGIN,
          modelId: TEST_MODEL_ID,
          modelName: "model",
          provider: "provider",
          capabilities: [],
          requestedAt: Date.now(),
          dismissed: false,
          status: "pending" as const,
        },
      }),
    resolvePermissionRequest: (payload: {
      requestId: string;
      decision: "allowed" | "denied";
    }) =>
      Effect.succeed({
        requestId: payload.requestId,
        decision: payload.decision,
      }),
    dismissPermissionRequest: (requestId: string) =>
      Effect.succeed({
        requestId,
      }),
    waitForPermissionDecision: (
      _requestId: string,
      _timeoutMs?: number,
      signal?: AbortSignal,
    ) => {
      if (input.waitBehavior === "resolved") {
        return Effect.succeed("resolved" as const);
      }

      return Effect.tryPromise({
        try: () =>
          new Promise<"aborted">((resolve) => {
            if (signal?.aborted) {
              resolve("aborted");
              return;
            }
            signal?.addEventListener("abort", () => resolve("aborted"), {
              once: true,
            });
          }),
        catch: () =>
          new RuntimeValidationError({
            message: "Permission wait failed",
          }),
      });
    },
  } satisfies PermissionsRepositoryApi;

  const metaRepo = {
    parseProviderModel: (modelID: string) => ({
      providerID: modelID.split("/")[0] ?? "provider",
      modelID: modelID.split("/")[1] ?? modelID,
    }),
    resolvePermissionTarget: (modelID: string) => {
      if (modelID !== TEST_MODEL_ID) {
        return Effect.fail(
          new ModelNotFoundError({
            modelId: modelID,
            message: `Model ${modelID} was not found`,
          }),
        );
      }

      return Effect.succeed({
        modelId: TEST_MODEL_ID,
        modelName: "model",
        provider: "provider",
        capabilities: [],
      });
    },
  } satisfies MetaRepositoryApi;

  const modelRepo = {
    acquireModel: () =>
      Effect.succeed({
        specificationVersion: "v3" as const,
        provider: "provider",
        modelId: TEST_MODEL_ID,
        supportedUrls: {},
      }),
    generateModel: () =>
      Effect.sync(() => {
        generateCalls += 1;
        return {
          content: [],
          finishReason: {
            unified: "stop" as const,
          },
          usage: {
            inputTokens: {},
            outputTokens: {},
          },
          warnings: [],
        };
      }),
    streamModel: () =>
      Effect.succeed(
        new ReadableStream({
          start(controller) {
            controller.close();
          },
        }),
      ),
  } satisfies ModelExecutionRepositoryApi;

  const layer = ModelExecutionServiceLive.pipe(
    Layer.provideMerge(PermissionServiceLive),
    Layer.provideMerge(Layer.succeed(PermissionsRepository, permissionsRepo)),
    Layer.provideMerge(Layer.succeed(MetaRepository, metaRepo)),
    Layer.provideMerge(Layer.succeed(ModelExecutionRepository, modelRepo)),
  );

  const service = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* ModelExecutionService;
    }).pipe(Effect.provide(layer)),
  );

  return {
    service,
    getGenerateCalls: () => generateCalls,
  };
}

function modelCallInput() {
  return {
    origin: TEST_ORIGIN,
    requestID: TEST_REQUEST_ID,
    sessionID: TEST_SESSION_ID,
    modelID: TEST_MODEL_ID,
    options: {
      prompt: [
        {
          role: "system" as const,
          content: "test",
        },
      ],
    },
  };
}

function abortInput() {
  return {
    origin: TEST_ORIGIN,
    requestID: TEST_REQUEST_ID,
    sessionID: TEST_SESSION_ID,
  };
}

describe("ModelExecutionService permission wait cancellation", () => {
  it("stops generation when abortModelCall occurs during permission wait", async () => {
    const { service, getGenerateCalls } = await createModelExecutionService({
      waitBehavior: "signal-abort",
    });

    const generateTask = Effect.runPromise(
      service.generateModel(modelCallInput()),
    );
    await sleep(5);
    await Effect.runPromise(service.abortModelCall(abortInput()));

    await expect(generateTask).rejects.toThrow(/Request canceled/);
    expect(getGenerateCalls()).toBe(0);
  });

  it("honors aborts that arrive before controller registration", async () => {
    const { service, getGenerateCalls } = await createModelExecutionService({
      waitBehavior: "signal-abort",
    });

    await Effect.runPromise(service.abortModelCall(abortInput()));

    await expect(
      Effect.runPromise(service.generateModel(modelCallInput())),
    ).rejects.toThrow(/Request canceled/);
    expect(getGenerateCalls()).toBe(0);
  });

  it("continues to model generation when permission wait resolves", async () => {
    const { service, getGenerateCalls } = await createModelExecutionService({
      waitBehavior: "resolved",
      postWaitPermission: "allowed",
    });

    const result = await Effect.runPromise(
      service.generateModel(modelCallInput()),
    );
    expect(result.finishReason.unified).toBe("stop");
    expect(getGenerateCalls()).toBe(1);
  });
});

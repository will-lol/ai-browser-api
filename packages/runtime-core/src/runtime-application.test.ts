import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type {
  AuthRepositoryApi,
  CatalogRepositoryApi,
  MetaRepositoryApi,
  ModelExecutionRepositoryApi,
  ModelsRepositoryApi,
  PendingRequestsRepositoryApi,
  PermissionsRepositoryApi,
  ProvidersRepositoryApi,
} from "./repositories";
import {
  AuthRepository,
  CatalogRepository,
  MetaRepository,
  ModelExecutionRepository,
  ModelsRepository,
  PendingRequestsRepository,
  PermissionsRepository,
  ProvidersRepository,
} from "./repositories";
import {
  RuntimeApplication,
  RuntimeApplicationLive,
} from "./runtime-application";

const TEST_ORIGIN = "https://example.test";
const TEST_PROVIDER_ID = "openai";
const TEST_MODEL_ID = "openai/gpt-4o-mini";

describe("RuntimeApplication read paths", () => {
  it("resolves from repositories alone and reads startup/query paths directly", async () => {
    const trace = {
      ensureCatalog: 0,
      listProviders: 0,
      listModels: [] as Array<{
        connectedOnly?: boolean;
        providerID?: string;
      }>,
      getOriginState: [] as string[],
      listPermissions: [] as string[],
      listPending: [] as string[],
      authCalls: 0,
      permissionMutations: 0,
      modelExecutions: 0,
    };

    const providersRepo = {
      listProviders: () =>
        Effect.sync(() => {
          trace.listProviders += 1;
          return [
            {
              id: TEST_PROVIDER_ID,
              name: "OpenAI",
              connected: true,
              env: [],
              modelCount: 1,
            },
          ] as const;
        }),
    } satisfies ProvidersRepositoryApi;

    const modelsRepo = {
      listModels: (input: { connectedOnly?: boolean; providerID?: string }) =>
        Effect.sync(() => {
          trace.listModels.push(input);
          return [
            {
              id: TEST_MODEL_ID,
              name: "GPT-4o mini",
              provider: TEST_PROVIDER_ID,
              capabilities: ["text"],
              connected: true,
            },
          ] as const;
        }),
    } satisfies ModelsRepositoryApi;

    const permissionsRepo = {
      getOriginState: (origin: string) =>
        Effect.sync(() => {
          trace.getOriginState.push(origin);
          return {
            origin,
            enabled: true,
          };
        }),
      listPermissions: (origin: string) =>
        Effect.sync(() => {
          trace.listPermissions.push(origin);
          return [
            {
              modelId: TEST_MODEL_ID,
              modelName: "GPT-4o mini",
              provider: TEST_PROVIDER_ID,
              status: "allowed" as const,
              capabilities: ["text"],
              requestedAt: 1,
            },
          ] as const;
        }),
      getModelPermission: () => Effect.succeed("allowed" as const),
      setOriginEnabled: (origin: string, enabled: boolean) =>
        Effect.sync(() => {
          trace.permissionMutations += 1;
          return { origin, enabled };
        }),
      updatePermission: (input) =>
        Effect.sync(() => {
          trace.permissionMutations += 1;
          return {
            origin: input.origin,
            modelId: input.modelID,
            status: input.status,
          };
        }),
      createPermissionRequest: (input) =>
        Effect.sync(() => {
          trace.permissionMutations += 1;
          return {
            status: "requested" as const,
            request: {
              id: "prm_1",
              origin: input.origin,
              modelId: input.modelId,
              modelName: input.modelName,
              provider: input.provider,
              capabilities: [...(input.capabilities ?? [])],
              requestedAt: 1,
              dismissed: false,
              status: "pending" as const,
            },
          };
        }),
      resolvePermissionRequest: (input) =>
        Effect.sync(() => {
          trace.permissionMutations += 1;
          return {
            requestId: input.requestId,
            decision: input.decision,
          };
        }),
      dismissPermissionRequest: (requestId: string) =>
        Effect.sync(() => {
          trace.permissionMutations += 1;
          return { requestId };
        }),
      waitForPermissionDecision: () => Effect.succeed("resolved" as const),
    } satisfies PermissionsRepositoryApi;

    const pendingRepo = {
      listPending: (origin: string) =>
        Effect.sync(() => {
          trace.listPending.push(origin);
          return [
            {
              id: "prm_1",
              origin,
              modelId: TEST_MODEL_ID,
              modelName: "GPT-4o mini",
              provider: TEST_PROVIDER_ID,
              capabilities: ["text"],
              requestedAt: 1,
              dismissed: false,
              status: "pending" as const,
            },
          ] as const;
        }),
    } satisfies PendingRequestsRepositoryApi;

    const catalogRepo = {
      ensureCatalog: () =>
        Effect.sync(() => {
          trace.ensureCatalog += 1;
        }),
      refreshCatalog: () => Effect.void,
      refreshCatalogForProvider: () => Effect.void,
    } satisfies CatalogRepositoryApi;

    const authRepo = {
      openProviderAuthWindow: (providerID: string) =>
        Effect.sync(() => {
          trace.authCalls += 1;
          return { providerID, reused: false, windowId: 1 };
        }),
      getProviderAuthFlow: (providerID: string) =>
        Effect.sync(() => {
          trace.authCalls += 1;
          return {
            providerID,
            result: {
              providerID,
              status: "idle" as const,
              methods: [],
              updatedAt: 1,
              canCancel: false,
            },
          };
        }),
      startProviderAuthFlow: (input: {
        providerID: string;
        methodID: string;
        values?: Record<string, string>;
      }) =>
        Effect.sync(() => {
          trace.authCalls += 1;
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
      cancelProviderAuthFlow: (input: {
        providerID: string;
        reason?: string;
      }) =>
        Effect.sync(() => {
          trace.authCalls += 1;
          return {
            providerID: input.providerID,
            result: {
              providerID: input.providerID,
              status: "canceled" as const,
              methods: [],
              updatedAt: 1,
              canCancel: false,
            },
          };
        }),
      disconnectProvider: (providerID: string) =>
        Effect.sync(() => {
          trace.authCalls += 1;
          return {
            providerID,
            connected: false,
          };
        }),
    } satisfies AuthRepositoryApi;

    const metaRepo = {
      parseProviderModel: (modelID: string) => ({
        providerID: modelID.split("/")[0] ?? TEST_PROVIDER_ID,
        modelID: modelID.split("/")[1] ?? modelID,
      }),
      resolvePermissionTarget: (modelID: string) =>
        Effect.succeed({
          modelId: modelID,
          modelName: "GPT-4o mini",
          provider: TEST_PROVIDER_ID,
          capabilities: ["text"],
        }),
    } satisfies MetaRepositoryApi;

    const modelExecutionRepo = {
      acquireModel: () =>
        Effect.sync(() => {
          trace.modelExecutions += 1;
          return {
            specificationVersion: "v3" as const,
            provider: TEST_PROVIDER_ID,
            modelId: TEST_MODEL_ID,
            supportedUrls: {},
          };
        }),
      generateModel: () =>
        Effect.sync(() => {
          trace.modelExecutions += 1;
          return {
            content: [],
            finishReason: { unified: "stop" as const },
            usage: { inputTokens: {}, outputTokens: {} },
            warnings: [],
          };
        }),
      streamModel: () =>
        Effect.sync(() => {
          trace.modelExecutions += 1;
          return new ReadableStream({
            start(controller) {
              controller.close();
            },
          });
        }),
    } satisfies ModelExecutionRepositoryApi;

    const layer = RuntimeApplicationLive.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(ProvidersRepository, providersRepo),
          Layer.succeed(ModelsRepository, modelsRepo),
          Layer.succeed(PermissionsRepository, permissionsRepo),
          Layer.succeed(PendingRequestsRepository, pendingRepo),
          Layer.succeed(CatalogRepository, catalogRepo),
          Layer.succeed(AuthRepository, authRepo),
          Layer.succeed(MetaRepository, metaRepo),
          Layer.succeed(ModelExecutionRepository, modelExecutionRepo),
        ),
      ),
    );

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const app = yield* RuntimeApplication;
        yield* app.startup();

        return {
          providers: yield* app.listProviders(),
          models: yield* app.listModels({
            providerID: TEST_PROVIDER_ID,
          }),
          connectedModels: yield* app.listConnectedModels(),
          originState: yield* app.getOriginState(TEST_ORIGIN),
          permissions: yield* app.listPermissions(TEST_ORIGIN),
          pending: yield* app.listPending(TEST_ORIGIN),
        };
      }).pipe(Effect.provide(layer)),
    );

    assert.equal(trace.ensureCatalog, 1);
    assert.equal(trace.listProviders, 1);
    assert.deepEqual(trace.listModels, [
      {
        connectedOnly: undefined,
        providerID: TEST_PROVIDER_ID,
      },
      {
        connectedOnly: true,
      },
    ]);
    assert.deepEqual(trace.getOriginState, [TEST_ORIGIN]);
    assert.deepEqual(trace.listPermissions, [TEST_ORIGIN]);
    assert.deepEqual(trace.listPending, [TEST_ORIGIN]);
    assert.equal(trace.authCalls, 0);
    assert.equal(trace.permissionMutations, 0);
    assert.equal(trace.modelExecutions, 0);

    assert.equal(result.providers[0]?.id, TEST_PROVIDER_ID);
    assert.equal(result.models[0]?.id, TEST_MODEL_ID);
    assert.equal(result.connectedModels[0]?.id, TEST_MODEL_ID);
    assert.deepEqual(result.originState, {
      origin: TEST_ORIGIN,
      enabled: true,
    });
    assert.equal(result.permissions[0]?.modelId, TEST_MODEL_ID);
    assert.equal(result.pending[0]?.id, "prm_1");
  });
});

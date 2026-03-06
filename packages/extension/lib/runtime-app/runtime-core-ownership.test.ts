import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  RuntimeModelCallOptions,
  RuntimeRequestPermissionInput,
} from "@llm-bridge/contracts";
import {
  AuthFlowService,
  AuthFlowServiceLive,
  AuthRepository,
  CatalogRepository,
  ModelExecutionRepository,
  ModelExecutionService,
  ModelExecutionServiceLive,
  PermissionService,
} from "@llm-bridge/runtime-core";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

const modelOptions: RuntimeModelCallOptions = {
  prompt: [{ role: "system", content: "test" }],
};

describe("runtime-core ownership", () => {
  it("owns provider catalog refresh at auth orchestration level", async () => {
    const refreshed: string[] = [];

    const layer = AuthFlowServiceLive.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(AuthRepository, {
            openProviderAuthWindow: (providerID: string) =>
              Effect.succeed({ providerID, reused: false, windowId: 1 }),
            getProviderAuthFlow: (providerID: string) =>
              Effect.succeed({
                providerID,
                result: {
                  providerID,
                  status: "success",
                  methods: [],
                  updatedAt: 1,
                  canCancel: false,
                } as const,
              }),
            startProviderAuthFlow: (input: {
              providerID: string;
              methodID: string;
              values?: Record<string, string>;
            }) =>
              Effect.succeed({
                providerID: input.providerID,
                result: {
                  providerID: input.providerID,
                  status: "success",
                  methods: [],
                  updatedAt: 1,
                  canCancel: false,
                } as const,
              }),
            cancelProviderAuthFlow: (input: {
              providerID: string;
              reason?: string;
            }) =>
              Effect.succeed({
                providerID: input.providerID,
                result: {
                  providerID: input.providerID,
                  status: "canceled",
                  methods: [],
                  updatedAt: 1,
                  canCancel: false,
                } as const,
              }),
            disconnectProvider: (providerID: string) =>
              Effect.succeed({ providerID, connected: false }),
          }),
          Layer.succeed(CatalogRepository, {
            ensureCatalog: () => Effect.void,
            refreshCatalog: () => Effect.void,
            refreshCatalogForProvider: (providerID: string) =>
              Effect.sync(() => {
                refreshed.push(providerID);
              }),
          }),
        ),
      ),
    );

    await Effect.runPromise(
      Effect.gen(function* () {
        const auth = yield* AuthFlowService;
        yield* auth.startProviderAuthFlow({
          providerID: "openai",
          methodID: "api-key",
        });
        yield* auth.disconnectProvider("openai");
      }).pipe(Effect.provide(layer)),
    );

    assert.deepEqual(refreshed, ["openai", "openai"]);
  });

  it("owns permission/origin checks before model repository execution", async () => {
    let originChecks = 0;
    let permissionChecks = 0;
    let acquireCalls = 0;
    let generateCalls = 0;
    let streamCalls = 0;

    const layer = ModelExecutionServiceLive.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(PermissionService, {
            ensureOriginEnabled: () =>
              Effect.sync(() => {
                originChecks += 1;
              }),
            ensureRequestAllowed: () =>
              Effect.sync(() => {
                permissionChecks += 1;
              }),
            setOriginEnabled: (origin: string, enabled: boolean) =>
              Effect.succeed({ origin, enabled }),
            updatePermission: (input: {
              origin: string;
              modelID: string;
              status: "allowed" | "denied";
            }) =>
              Effect.succeed({
                origin: input.origin,
                modelId: input.modelID,
                status: input.status,
              }),
            requestPermission: (_input: RuntimeRequestPermissionInput) =>
              Effect.succeed({ status: "alreadyAllowed" as const }),
          }),
          Layer.succeed(ModelExecutionRepository, {
            acquireModel: (input: { modelID: string }) =>
              Effect.sync(() => {
                acquireCalls += 1;
                return {
                  specificationVersion: "v3" as const,
                  provider: "provider",
                  modelId: input.modelID,
                  supportedUrls: {},
                };
              }),
            generateModel: () =>
              Effect.sync(() => {
                generateCalls += 1;
                return {
                  content: [],
                  finishReason: { unified: "stop" as const },
                  usage: { inputTokens: {}, outputTokens: {} },
                  warnings: [],
                };
              }),
            streamModel: () =>
              Effect.sync(() => {
                streamCalls += 1;
                return new ReadableStream<never>({
                  start(controller) {
                    controller.close();
                  },
                });
              }),
          }),
        ),
      ),
    );

    await Effect.runPromise(
      Effect.gen(function* () {
        const models = yield* ModelExecutionService;
        yield* models.acquireModel({
          origin: "https://example.test",
          sessionID: "s1",
          requestID: "r1",
          modelID: "openai/gpt-4o-mini",
        });
        yield* models.generateModel({
          origin: "https://example.test",
          sessionID: "s1",
          requestID: "r2",
          modelID: "openai/gpt-4o-mini",
          options: modelOptions,
        });
        yield* models.streamModel({
          origin: "https://example.test",
          sessionID: "s1",
          requestID: "r3",
          modelID: "openai/gpt-4o-mini",
          options: modelOptions,
        });
      }).pipe(Effect.provide(layer)),
    );

    assert.equal(originChecks, 3);
    assert.equal(permissionChecks, 3);
    assert.equal(acquireCalls, 1);
    assert.equal(generateCalls, 1);
    assert.equal(streamCalls, 1);
  });
});

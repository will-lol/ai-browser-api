import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import {
  AuthFlowService,
  CatalogService,
  ChatExecutionService,
  MetaService,
  ModelExecutionService,
  PermissionsService,
} from "@llm-bridge/runtime-core";
import type { RuntimeProviderSummary } from "@llm-bridge/contracts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Stream from "effect/Stream";

type ProviderRow = {
  id: string;
  name: string;
  connected: boolean;
  env: ReadonlyArray<string>;
  modelCount: number;
};

type ModelRow = {
  id: string;
  providerID: string;
  capabilities: ReadonlyArray<string>;
  info: {
    name: string;
  };
};

let providerRows: Array<ProviderRow> = [];
let modelRows: Array<ModelRow> = [];

mock.module("@/background/runtime/catalog/provider-registry-query", () => ({
  listProviderRows: () => Effect.succeed(providerRows),
  listModelRows: () => Effect.succeed(modelRows),
}));

mock.module("@/background/runtime/catalog/provider-registry-refresh", () => ({
  ensureProviderCatalog: () => Effect.void,
  refreshProviderCatalog: () => Effect.void,
  refreshProviderCatalogForProvider: () => Effect.void,
}));

const { CatalogServiceLive } = await import("./catalog-service");

function makeUnusedRuntimeLayer() {
  return Layer.mergeAll(
    Layer.succeed(PermissionsService, {
      getOriginState: () => Effect.die("unused"),
      streamOriginState: () => Stream.empty,
      listPermissions: () => Effect.die("unused"),
      streamPermissions: () => Stream.empty,
      getModelPermission: () => Effect.die("unused"),
      setOriginEnabled: () => Effect.die("unused"),
      setModelPermission: () => Effect.die("unused"),
      createPermissionRequest: () => Effect.die("unused"),
      resolvePermissionRequest: () => Effect.die("unused"),
      dismissPermissionRequest: () => Effect.die("unused"),
      listPending: () => Effect.die("unused"),
      streamPending: () => Stream.empty,
      waitForPermissionDecision: () => Effect.die("unused"),
      streamOriginStates: () => Stream.empty,
      streamPermissionsMap: () => Stream.empty,
      streamPendingMap: () => Stream.empty,
    }),
    Layer.succeed(AuthFlowService, {
      openProviderAuthWindow: () => Effect.die("unused"),
      getProviderAuthFlow: () => Effect.die("unused"),
      streamProviderAuthFlow: () => Stream.empty,
      startProviderAuthFlow: () => Effect.die("unused"),
      cancelProviderAuthFlow: () => Effect.die("unused"),
      disconnectProvider: () => Effect.die("unused"),
    }),
    Layer.succeed(MetaService, {
      parseProviderModel: () => ({
        providerID: "unused",
        modelID: "unused",
      }),
      resolvePermissionTarget: () => Effect.die("unused"),
    }),
    Layer.succeed(ModelExecutionService, {
      acquireModel: () => Effect.die("unused"),
      generateModel: () => Effect.die("unused"),
      streamModel: () => Effect.die("unused"),
    }),
    Layer.succeed(ChatExecutionService, {
      sendMessages: () => Effect.die("unused"),
      reconnectStream: () => Effect.die("unused"),
      abortStream: () => Effect.die("unused"),
    }),
  );
}

function makeRuntime() {
  return ManagedRuntime.make(Layer.mergeAll(CatalogServiceLive, makeUnusedRuntimeLayer()));
}

async function getCatalogService(
  runtime: ReturnType<typeof makeRuntime>,
) {
  return runtime.runPromise(Effect.gen(function* () {
    return yield* CatalogService;
  }));
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 250,
): Promise<void> {
  const start = Date.now();

  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("Timed out waiting for condition");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe("CatalogServiceLive", () => {
  beforeEach(() => {
    providerRows = [
      {
        id: "openai",
        name: "OpenAI",
        connected: true,
        env: ["oauth"],
        modelCount: 1,
      },
    ];
    modelRows = [
      {
        id: "openai/gpt-5",
        providerID: "openai",
        capabilities: ["text"],
        info: {
          name: "GPT-5",
        },
      },
    ];
  });

  afterEach(async () => {
    providerRows = [];
    modelRows = [];
  });

  it("emits initial providers and later updates from the canonical snapshot", async () => {
    const runtime = makeRuntime();
    const service = await getCatalogService(runtime);
    const updates: Array<ReadonlyArray<RuntimeProviderSummary>> = [];

    const fiber = runtime.runFork(
      Effect.scoped(
        service.streamProviders().pipe(
          Stream.runForEach((providers) =>
            Effect.sync(() => {
              updates.push(providers);
            }),
          ),
        ),
      ),
    );

    await waitFor(() => updates.length === 1);

    providerRows = [
      ...providerRows,
      {
        id: "anthropic",
        name: "Anthropic",
        connected: false,
        env: ["apiKey"],
        modelCount: 1,
      },
    ];
    modelRows = [
      ...modelRows,
      {
        id: "anthropic/claude-3.7",
        providerID: "anthropic",
        capabilities: ["text"],
        info: {
          name: "Claude 3.7",
        },
      },
    ];

    await runtime.runPromise(service.refreshCatalog());
    await waitFor(() => updates.length === 2);

    expect(updates[0]).toEqual([
      {
        id: "openai",
        name: "OpenAI",
        connected: true,
        env: ["oauth"],
        modelCount: 1,
      },
    ]);
    expect(updates[1]).toEqual([
      {
        id: "anthropic",
        name: "Anthropic",
        connected: false,
        env: ["apiKey"],
        modelCount: 1,
      },
      {
        id: "openai",
        name: "OpenAI",
        connected: true,
        env: ["oauth"],
        modelCount: 1,
      },
    ]);

    await Effect.runPromise(Fiber.interrupt(fiber));
    await runtime.dispose();
  });

  it("does not emit duplicate provider snapshots when refresh results are unchanged", async () => {
    const runtime = makeRuntime();
    const service = await getCatalogService(runtime);
    const updates: Array<ReadonlyArray<unknown>> = [];

    const fiber = runtime.runFork(
      Effect.scoped(
        service.streamProviders().pipe(
          Stream.runForEach((providers) =>
            Effect.sync(() => {
              updates.push(providers);
            }),
          ),
        ),
      ),
    );

    await waitFor(() => updates.length === 1);
    await runtime.runPromise(service.refreshCatalog());
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(updates).toHaveLength(1);

    await Effect.runPromise(Fiber.interrupt(fiber));
    await runtime.dispose();
  });

  it("keeps filtered model streams stable when unrelated snapshot fields change", async () => {
    const runtime = makeRuntime();
    const service = await getCatalogService(runtime);
    const updates: Array<ReadonlyArray<unknown>> = [];

    const fiber = runtime.runFork(
      Effect.scoped(
        service
          .streamModels({
            connectedOnly: true,
          })
          .pipe(
            Stream.runForEach((models) =>
              Effect.sync(() => {
                updates.push(models);
              }),
            ),
          ),
      ),
    );

    await waitFor(() => updates.length === 1);

    providerRows = [
      {
        id: "openai",
        name: "OpenAI",
        connected: true,
        env: ["oauth"],
        modelCount: 2,
      },
      {
        id: "anthropic",
        name: "Anthropic",
        connected: false,
        env: ["apiKey"],
        modelCount: 1,
      },
    ];
    modelRows = [
      ...modelRows,
      {
        id: "anthropic/claude-3.7",
        providerID: "anthropic",
        capabilities: ["text"],
        info: {
          name: "Claude 3.7",
        },
      },
    ];

    await runtime.runPromise(service.refreshCatalog());
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(updates).toHaveLength(1);

    await Effect.runPromise(Fiber.interrupt(fiber));
    await runtime.dispose();
  });
});

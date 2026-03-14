import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import {
  AuthFlowService,
  CatalogService,
  ChatExecutionService,
  MetaService,
  ModelExecutionService,
  PermissionsService,
} from "@llm-bridge/runtime-core";
import type {
  RuntimeCreatePermissionRequestResponse,
  RuntimePendingRequest,
  RuntimePermissionDecision,
  RuntimePermissionEntry,
} from "@llm-bridge/contracts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Stream from "effect/Stream";

type OriginRow = {
  origin: string;
  enabled: boolean;
};

type PermissionRow = {
  origin: string;
  modelId: string;
  status: RuntimePermissionDecision;
  capabilities: ReadonlyArray<string>;
  updatedAt: number;
};

type PendingRow = {
  id: string;
  origin: string;
  modelId: string;
  modelName: string;
  provider: string;
  capabilities: ReadonlyArray<string>;
  requestedAt: number;
  dismissed: boolean;
  status: "pending" | "resolved";
};

type ModelRow = {
  id: string;
  providerID: string;
  info: {
    name: string;
  };
  capabilities: ReadonlyArray<string>;
};

let originRows: Array<OriginRow> = [];
let permissionRows: Array<PermissionRow> = [];
let pendingRows: Array<PendingRow> = [];
let modelRows = new Map<string, ModelRow>();
let nextPendingId = 1;

mock.module("@/background/storage/runtime-db", () => ({
  runtimeDb: {
    origins: {
      toArray: async () => originRows,
    },
    permissions: {
      toArray: async () => permissionRows,
    },
    models: {
      bulkGet: async (ids: ReadonlyArray<string>) =>
        ids.map((id) => modelRows.get(id)),
    },
    pendingRequests: {
      where: () => ({
        equals: () => ({
          filter: (predicate: (row: PendingRow) => boolean) => ({
            toArray: async () =>
              pendingRows
                .filter((row) => row.status === "pending")
                .filter(predicate),
          }),
        }),
      }),
    },
  },
}));

mock.module("@/background/runtime/permissions", () => ({
  getModelPermission: (origin: string, modelID: string) =>
    Effect.succeed(
      permissionRows.find(
        (row) => row.origin === origin && row.modelId === modelID,
      )?.status ?? "pending",
    ),
  getPendingRequest: (requestId: string) =>
    Effect.succeed(
      pendingRows.find((row) => row.id === requestId) ?? null,
    ),
  setOriginEnabled: (origin: string, enabled: boolean) =>
    Effect.sync(() => {
      const existing = originRows.find((row) => row.origin === origin);
      if (existing) {
        existing.enabled = enabled;
        return;
      }
      originRows.push({
        origin,
        enabled,
      });
    }),
  setModelPermission: (
    origin: string,
    modelID: string,
    status: RuntimePermissionDecision,
    capabilities?: ReadonlyArray<string>,
  ) =>
    Effect.sync(() => {
      const existing = permissionRows.find(
        (row) => row.origin === origin && row.modelId === modelID,
      );
      const nextCapabilities = capabilities ?? [];
      if (existing) {
        existing.status = status;
        existing.capabilities = nextCapabilities;
        existing.updatedAt += 1;
        return;
      }

      permissionRows.push({
        origin,
        modelId: modelID,
        status,
        capabilities: nextCapabilities,
        updatedAt: Date.now(),
      });
    }),
  createPermissionRequest: (input: {
    origin: string;
    modelId: string;
    provider: string;
    modelName: string;
    capabilities?: ReadonlyArray<string>;
  }) =>
    Effect.sync(() => {
      const request: RuntimePendingRequest = {
        id: `request-${nextPendingId++}`,
        origin: input.origin,
        modelId: input.modelId,
        modelName: input.modelName,
        provider: input.provider,
        capabilities: input.capabilities ?? [],
        requestedAt: Date.now(),
        dismissed: false,
        status: "pending",
      };
      pendingRows.push(request);
      return {
        status: "requested",
        request,
      } satisfies RuntimeCreatePermissionRequestResponse;
    }),
  resolvePermissionRequest: (requestId: string, _decision: RuntimePermissionDecision) =>
    Effect.sync(() => {
      const row = pendingRows.find((item) => item.id === requestId);
      if (row) {
        row.status = "resolved";
      }
    }),
  dismissPermissionRequest: (requestId: string) =>
    Effect.sync(() => {
      const row = pendingRows.find((item) => item.id === requestId);
      if (row) {
        row.dismissed = true;
      }
    }),
}));

const { PermissionsServiceLive } = await import("./permissions-service");

function makeUnusedRuntimeLayer() {
  return Layer.mergeAll(
    Layer.succeed(CatalogService, {
      ensureCatalog: () => Effect.die("unused"),
      refreshCatalog: () => Effect.die("unused"),
      refreshCatalogForProvider: () => Effect.die("unused"),
      listProviders: () => Effect.die("unused"),
      streamProviders: () => Stream.empty,
      listModels: () => Effect.die("unused"),
      streamModels: () => Stream.empty,
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
  return ManagedRuntime.make(
    Layer.mergeAll(PermissionsServiceLive, makeUnusedRuntimeLayer()),
  );
}

async function getPermissionsService(
  runtime: ReturnType<typeof makeRuntime>,
) {
  return runtime.runPromise(Effect.gen(function* () {
    return yield* PermissionsService;
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

describe("PermissionsServiceLive", () => {
  beforeEach(() => {
    originRows = [];
    permissionRows = [];
    pendingRows = [];
    modelRows = new Map([
      [
        "openai/gpt-5",
        {
          id: "openai/gpt-5",
          providerID: "openai",
          info: {
            name: "GPT-5",
          },
          capabilities: ["text"],
        },
      ],
    ]);
    nextPendingId = 1;
  });

  afterEach(async () => {
    originRows = [];
    permissionRows = [];
    pendingRows = [];
    modelRows = new Map();
  });

  it("defaults missing origins to enabled and publishes updates after mutation", async () => {
    const runtime = makeRuntime();
    const service = await getPermissionsService(runtime);
    const states: Array<{ origin: string; enabled: boolean }> = [];

    expect(
      await runtime.runPromise(service.getOriginState("https://example.test")),
    ).toEqual({
      origin: "https://example.test",
      enabled: true,
    });

    const fiber = runtime.runFork(
      Effect.scoped(
        service.streamOriginState("https://example.test").pipe(
          Stream.runForEach((state) =>
            Effect.sync(() => {
              states.push(state);
            }),
          ),
        ),
      ),
    );

    await waitFor(() => states.length === 1);
    await runtime.runPromise(
      service.setOriginEnabled("https://example.test", false),
    );
    await waitFor(() => states.length === 2);

    expect(states).toEqual([
      {
        origin: "https://example.test",
        enabled: true,
      },
      {
        origin: "https://example.test",
        enabled: false,
      },
    ]);

    await Effect.runPromise(Fiber.interrupt(fiber));
    await runtime.dispose();
  });

  it("does not emit duplicate origin-state snapshots for unchanged refreshes", async () => {
    originRows = [
      {
        origin: "https://example.test",
        enabled: true,
      },
    ];

    const runtime = makeRuntime();
    const service = await getPermissionsService(runtime);
    const states: Array<{ origin: string; enabled: boolean }> = [];

    const fiber = runtime.runFork(
      Effect.scoped(
        service.streamOriginState("https://example.test").pipe(
          Stream.runForEach((state) =>
            Effect.sync(() => {
              states.push(state);
            }),
          ),
        ),
      ),
    );

    await waitFor(() => states.length === 1);
    await runtime.runPromise(
      service.setOriginEnabled("https://example.test", true),
    );
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(states).toHaveLength(1);

    await Effect.runPromise(Fiber.interrupt(fiber));
    await runtime.dispose();
  });

  it("keeps toolbar-facing maps aligned with permission and pending mutations", async () => {
    const runtime = makeRuntime();
    const service = await getPermissionsService(runtime);
    const permissionMaps: Array<
      ReadonlyMap<string, ReadonlyArray<RuntimePermissionEntry>>
    > = [];
    const pendingMaps: Array<
      ReadonlyMap<string, ReadonlyArray<RuntimePendingRequest>>
    > = [];

    const permissionsFiber = runtime.runFork(
      Effect.scoped(
        service.streamPermissionsMap().pipe(
          Stream.runForEach((entries) =>
            Effect.sync(() => {
              permissionMaps.push(entries);
            }),
          ),
        ),
      ),
    );
    const pendingFiber = runtime.runFork(
      Effect.scoped(
        service.streamPendingMap().pipe(
          Stream.runForEach((entries) =>
            Effect.sync(() => {
              pendingMaps.push(entries);
            }),
          ),
        ),
      ),
    );

    await waitFor(() => permissionMaps.length === 1 && pendingMaps.length === 1);

    await runtime.runPromise(
      service.setModelPermission({
        origin: "https://example.test",
        modelID: "openai/gpt-5",
        status: "allowed",
      }),
    );
    await runtime.runPromise(
      service.createPermissionRequest({
        origin: "https://example.test",
        modelId: "openai/gpt-5",
        modelName: "GPT-5",
        provider: "openai",
      }),
    );

    await waitFor(() => permissionMaps.length >= 2 && pendingMaps.length >= 2);

    expect(
      permissionMaps.at(-1)?.get("https://example.test"),
    ).toEqual([
      {
        modelId: "openai/gpt-5",
        modelName: "GPT-5",
        provider: "openai",
        status: "allowed",
        capabilities: ["text"],
        requestedAt: expect.any(Number),
      },
    ]);
    expect(pendingMaps.at(-1)?.get("https://example.test")).toEqual([
      {
        id: "request-1",
        origin: "https://example.test",
        modelId: "openai/gpt-5",
        modelName: "GPT-5",
        provider: "openai",
        capabilities: [],
        requestedAt: expect.any(Number),
        dismissed: false,
        status: "pending",
      },
    ]);

    await Effect.runPromise(Fiber.interrupt(permissionsFiber));
    await Effect.runPromise(Fiber.interrupt(pendingFiber));
    await runtime.dispose();
  });
});

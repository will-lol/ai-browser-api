import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PermissionsService, type AppRuntime } from "@llm-bridge/runtime-core";
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
import { makeUnusedRuntimeLayer } from "@/background/test-utils/runtime-service-stubs";
import { waitForCondition } from "@/background/test-utils/wait-for";

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

vi.doMock("@/background/storage/runtime-db", () => ({
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

vi.doMock("@/background/runtime/permissions", () => ({
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

function makeRuntime(): ManagedRuntime.ManagedRuntime<AppRuntime, unknown> {
  const liveLayer = PermissionsServiceLive;
  const stubsLayer = makeUnusedRuntimeLayer({
    omit: ["permissions"] as const,
  }).pipe(Layer.provide(liveLayer));

  return ManagedRuntime.make(Layer.merge(liveLayer, stubsLayer));
}

async function getPermissionsService(
  runtime: ReturnType<typeof makeRuntime>,
) {
  return runtime.runPromise(Effect.gen(function* () {
    return yield* PermissionsService;
  }));
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

    await waitForCondition(() => states.length === 1);
    await runtime.runPromise(
      service.setOriginEnabled("https://example.test", false),
    );
    await waitForCondition(() => states.length === 2);

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

    await waitForCondition(() => states.length === 1);
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

    await waitForCondition(
      () => permissionMaps.length === 1 && pendingMaps.length === 1,
    );

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

    await waitForCondition(
      () => permissionMaps.length >= 2 && pendingMaps.length >= 2,
    );

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
        capabilities: ["text"],
        requestedAt: expect.any(Number),
        dismissed: false,
        status: "pending",
      },
    ]);

    await Effect.runPromise(Fiber.interrupt(permissionsFiber));
    await Effect.runPromise(Fiber.interrupt(pendingFiber));
    await runtime.dispose();
  });

  it("prefers authoritative model rows when reconstructing permission and pending entries", async () => {
    permissionRows = [
      {
        origin: "https://example.test",
        modelId: "openai/gpt-5",
        status: "allowed",
        capabilities: ["stale"],
        updatedAt: 10,
      },
    ];
    pendingRows = [
      {
        id: "request-1",
        origin: "https://example.test",
        modelId: "openai/gpt-5",
        modelName: "Old Name",
        provider: "old-provider",
        capabilities: ["stale"],
        requestedAt: 20,
        dismissed: false,
        status: "pending",
      },
    ];
    modelRows = new Map([
      [
        "openai/gpt-5",
        {
          id: "openai/gpt-5",
          providerID: "openai",
          info: {
            name: "GPT-5",
          },
          capabilities: ["text", "code"],
        },
      ],
    ]);

    const runtime = makeRuntime();
    const service = await getPermissionsService(runtime);

    try {
      expect(
        await runtime.runPromise(service.listPermissions("https://example.test")),
      ).toEqual([
        {
          modelId: "openai/gpt-5",
          modelName: "GPT-5",
          provider: "openai",
          status: "allowed",
          capabilities: ["text", "code"],
          requestedAt: 10,
        },
      ]);
      expect(
        await runtime.runPromise(service.listPending("https://example.test")),
      ).toEqual([
        {
          id: "request-1",
          origin: "https://example.test",
          modelId: "openai/gpt-5",
          modelName: "GPT-5",
          provider: "openai",
          capabilities: ["text", "code"],
          requestedAt: 20,
          dismissed: false,
          status: "pending",
        },
      ]);
    } finally {
      await runtime.dispose();
    }
  });

  it("preserves slash-containing model suffixes when falling back without a model row", async () => {
    permissionRows = [
      {
        origin: "https://example.test",
        modelId: "lmstudio/qwen/qwen3-30b-a3b-2507",
        status: "allowed",
        capabilities: ["text"],
        updatedAt: 30,
      },
    ];
    modelRows = new Map();

    const runtime = makeRuntime();
    const service = await getPermissionsService(runtime);

    try {
      expect(
        await runtime.runPromise(service.listPermissions("https://example.test")),
      ).toEqual([
        {
          modelId: "lmstudio/qwen/qwen3-30b-a3b-2507",
          modelName: "qwen/qwen3-30b-a3b-2507",
          provider: "lmstudio",
          status: "allowed",
          capabilities: ["text"],
          requestedAt: 30,
        },
      ]);
    } finally {
      await runtime.dispose();
    }
  });
});

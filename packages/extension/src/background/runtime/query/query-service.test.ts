import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import * as Effect from "effect/Effect";

const TEST_ORIGIN = "https://example.test";
const TRUSTED_MODEL_ID = "openai/gpt-4o-mini";
const STALE_MODEL_ID = "missing/model";

const pendingRows: Array<{
  id: string;
  origin: string;
  modelId: string;
  modelName: string;
  provider: string;
  capabilities: string[];
  requestedAt: number;
  dismissed: boolean;
  status: "pending" | "resolved";
}> = [];

const modelRowsById = new Map<
  string,
  {
    id: string;
    providerID: string;
    capabilities: string[];
    info: {
      name: string;
    };
  }
>();
const providerRowsById = new Map<
  string,
  {
    id: string;
    connected: boolean;
  }
>();

const bulkGetMock = mock(async (modelIds: string[]) =>
  modelIds.map((modelId) => modelRowsById.get(modelId)),
);
const providersBulkGetMock = mock(async (providerIds: string[]) =>
  providerIds.map((providerId) => providerRowsById.get(providerId)),
);

mock.module("@/background/storage/runtime-db", () => ({
  runtimeDb: {
    models: {
      bulkGet: bulkGetMock,
    },
    providers: {
      bulkGet: providersBulkGetMock,
    },
    pendingRequests: {
      where: (_field: string) => ({
        equals: (_value: string) => ({
          filter: (
            predicate: (row: (typeof pendingRows)[number]) => boolean,
          ) => ({
            toArray: async () => pendingRows.filter(predicate),
          }),
        }),
      }),
    },
  },
}));

mock.module("@/background/runtime/catalog/provider-registry", () => ({
  listModelRows: mock(() => Effect.succeed([])),
  listProviderRows: mock(() => Effect.succeed([])),
  getProvider: mock(() => Effect.succeed(undefined)),
  getModel: mock(() => Effect.succeed(undefined)),
}));

mock.module("@/background/runtime/permissions/permission-targets", () => ({
  resolveTrustedPermissionTargets: (modelIds: string[]) =>
    Effect.succeed(
      new Map(
        modelIds.flatMap((modelId) => {
          const modelRow = modelRowsById.get(modelId);
          if (!modelRow) return [];
          const providerRow = providerRowsById.get(modelRow.providerID);
          if (!providerRow?.connected) return [];
          return [
            [
              modelId,
              {
                modelId,
                modelName: modelRow.info.name,
                provider: modelRow.providerID,
                capabilities: modelRow.capabilities,
              },
            ] as const,
          ];
        }),
      ),
    ),
}));

const providerRegistry = await import("@/background/runtime/catalog/provider-registry");
const listModelRowsMock = providerRegistry.listModelRows as ReturnType<
  typeof mock
>;
const listProviderRowsMock = providerRegistry.listProviderRows as ReturnType<
  typeof mock
>;

const { listPendingRequestsForOrigin, listProviders } =
  await import("@/background/runtime/query/query-service");

beforeEach(() => {
  pendingRows.length = 0;
  modelRowsById.clear();
  providerRowsById.clear();
  bulkGetMock.mockClear();
  providersBulkGetMock.mockClear();
  listModelRowsMock.mockReset();
  listProviderRowsMock.mockReset();
  listModelRowsMock.mockImplementation(() => Effect.succeed([]));
  listProviderRowsMock.mockImplementation(() => Effect.succeed([]));
});

afterAll(() => {
  mock.restore();
});

describe("listPendingRequestsForOrigin", () => {
  it("leaves provider row failures as defects until the rpc boundary", async () => {
    listProviderRowsMock.mockImplementationOnce(() =>
      Effect.promise(() => Promise.reject(new Error("db unavailable"))),
    );

    await expect(Effect.runPromise(listProviders())).rejects.toThrow(
      /db unavailable/,
    );
  });

  it("hydrates pending request display metadata from trusted model rows", async () => {
    pendingRows.push(
      {
        id: "prm_trusted",
        origin: TEST_ORIGIN,
        modelId: TRUSTED_MODEL_ID,
        modelName: "Spoofed model",
        provider: "spoofed-provider",
        capabilities: ["text"],
        requestedAt: 1,
        dismissed: false,
        status: "pending",
      },
      {
        id: "prm_stale",
        origin: TEST_ORIGIN,
        modelId: STALE_MODEL_ID,
        modelName: "Ghost model",
        provider: "ghost-provider",
        capabilities: ["vision"],
        requestedAt: 2,
        dismissed: false,
        status: "pending",
      },
    );

    modelRowsById.set(TRUSTED_MODEL_ID, {
      id: TRUSTED_MODEL_ID,
      providerID: "openai",
      capabilities: ["text", "code"],
      info: {
        name: "GPT-4o mini",
      },
    });
    modelRowsById.set(STALE_MODEL_ID, {
      id: STALE_MODEL_ID,
      providerID: "ghost-provider",
      capabilities: ["vision"],
      info: {
        name: "Ghost model",
      },
    });
    providerRowsById.set("openai", {
      id: "openai",
      connected: true,
    });
    providerRowsById.set("ghost-provider", {
      id: "ghost-provider",
      connected: false,
    });

    const result = await Effect.runPromise(
      listPendingRequestsForOrigin(TEST_ORIGIN),
    );

    expect(result).toEqual([
      {
        id: "prm_trusted",
        origin: TEST_ORIGIN,
        modelId: TRUSTED_MODEL_ID,
        modelName: "GPT-4o mini",
        provider: "openai",
        capabilities: ["text", "code"],
        requestedAt: 1,
        dismissed: false,
        status: "pending",
      },
    ]);
  });
});

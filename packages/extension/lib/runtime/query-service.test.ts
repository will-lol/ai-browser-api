import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { RuntimeInternalError } from "@llm-bridge/contracts";
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

mock.module("@/lib/runtime/db/runtime-db", () => ({
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

mock.module("@/lib/runtime/provider-registry", () => ({
  listModelRows: mock(async () => []),
  listProviderRows: mock(async () => []),
  getProvider: mock(async () => undefined),
  getModel: mock(async () => undefined),
}));

const providerRegistry = await import("@/lib/runtime/provider-registry");
const listModelRowsMock = providerRegistry.listModelRows as ReturnType<
  typeof mock
>;
const listProviderRowsMock = providerRegistry.listProviderRows as ReturnType<
  typeof mock
>;

const { listPendingRequestsForOrigin, listProviders } =
  await import("@/lib/runtime/query-service");

beforeEach(() => {
  pendingRows.length = 0;
  modelRowsById.clear();
  providerRowsById.clear();
  bulkGetMock.mockClear();
  providersBulkGetMock.mockClear();
  listModelRowsMock.mockReset();
  listProviderRowsMock.mockReset();
  listModelRowsMock.mockImplementation(async () => []);
  listProviderRowsMock.mockImplementation(async () => []);
});

afterAll(() => {
  mock.restore();
});

describe("listPendingRequestsForOrigin", () => {
  it("normalizes provider row failures into RuntimeInternalError", async () => {
    listProviderRowsMock.mockRejectedValueOnce(new Error("db unavailable"));

    const result = await Effect.runPromise(Effect.either(listProviders()));

    expect("left" in result).toBe(true);
    if ("left" in result) {
      expect(result.left).toEqual(
        new RuntimeInternalError({
          operation: "query.listProviders",
          message: "db unavailable",
        }),
      );
    }
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
    expect(bulkGetMock).toHaveBeenCalledWith([
      TRUSTED_MODEL_ID,
      STALE_MODEL_ID,
    ]);
    expect(providersBulkGetMock).toHaveBeenCalledWith([
      "openai",
      "ghost-provider",
    ]);
  });
});

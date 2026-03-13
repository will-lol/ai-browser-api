import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import * as Effect from "effect/Effect";

const MAX_PENDING_REQUESTS = 3;
const MAX_PENDING_REQUESTS_PER_ORIGIN = 2;
const TEST_ORIGIN = "https://example.test";

type PendingRow = {
  id: string;
  origin: string;
  modelId: string;
  modelName: string;
  provider: string;
  capabilities: string[];
  requestedAt: number;
  dismissed: boolean;
  status: "pending" | "resolved";
};

type PermissionRow = {
  id: string;
  origin: string;
  modelId: string;
  status: "allowed" | "denied" | "pending";
  capabilities: string[];
  updatedAt: number;
};

const pendingRows: PendingRow[] = [];
const permissionRows = new Map<string, PermissionRow>();
const originRows = new Map<
  string,
  { origin: string; enabled: boolean; updatedAt: number }
>();
const trustedTargetsById = new Map<
  string,
  {
    modelId: string;
    modelName: string;
    provider: string;
    capabilities: string[];
  }
>();
let idSequence = 0;
let nowValue = 100;

function createCollection(rows: PendingRow[]) {
  return {
    filter(predicate: (row: PendingRow) => boolean) {
      return createCollection(rows.filter(predicate));
    },
    async toArray() {
      return [...rows];
    },
    async first() {
      return rows[0];
    },
    async count() {
      return rows.length;
    },
  };
}

mock.module("@/background/runtime/core/constants", () => ({
  MAX_PENDING_REQUESTS,
  MAX_PENDING_REQUESTS_PER_ORIGIN,
  PENDING_REQUEST_TIMEOUT_MS: 30_000,
}));

mock.module("@/background/storage/runtime-db", () => ({
  runtimeDb: {
    origins: {
      get: async (origin: string) => originRows.get(origin),
      put: async (row: {
        origin: string;
        enabled: boolean;
        updatedAt: number;
      }) => {
        originRows.set(row.origin, row);
      },
    },
    permissions: {
      get: async (id: string) => permissionRows.get(id),
      put: async (row: PermissionRow) => {
        permissionRows.set(row.id, row);
      },
      delete: async (id: string) => {
        permissionRows.delete(id);
      },
      where: (_field: string) => ({
        equals: (value: string) => ({
          toArray: async () =>
            Array.from(permissionRows.values()).filter(
              (row) => row.origin === value,
            ),
        }),
      }),
    },
    pendingRequests: {
      get: async (id: string) => pendingRows.find((row) => row.id === id),
      put: async (row: PendingRow) => {
        const existingIndex = pendingRows.findIndex(
          (item) => item.id === row.id,
        );
        if (existingIndex >= 0) {
          pendingRows[existingIndex] = row;
          return;
        }
        pendingRows.push(row);
      },
      delete: async (id: string) => {
        const index = pendingRows.findIndex((row) => row.id === id);
        if (index >= 0) {
          pendingRows.splice(index, 1);
        }
      },
      where: (field: "origin" | "status") => ({
        equals: (value: string) =>
          createCollection(pendingRows.filter((row) => row[field] === value)),
      }),
    },
  },
}));

mock.module("@/background/storage/runtime-db-types", () => ({
  runtimePermissionKey: (origin: string, modelId: string) =>
    `${origin}::${modelId}`,
}));

mock.module("@/background/storage/runtime-db-tx", () => ({
  runTx: async (_tables: unknown[], fn: () => Promise<unknown>) => fn(),
}));

mock.module("@/background/runtime/permissions/permission-targets", () => ({
  resolveTrustedPermissionTargets: (modelIds: string[]) =>
    Effect.succeed(
      new Map(
        modelIds.flatMap((modelId) => {
          const target = trustedTargetsById.get(modelId);
          return target ? [[modelId, target] as const] : [];
        }),
      ),
    ),
}));

mock.module("@/background/runtime/core/util", () => ({
  getModelCapabilities: (modelId: string) => [`cap:${modelId}`],
  isObject: (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === "object" && !Array.isArray(value),
  mergeRecord: <T extends Record<string, unknown>>(
    base: T,
    patch?: Record<string, unknown>,
  ) => ({ ...base, ...(patch ?? {}) }) as T,
  now: () => {
    nowValue += 1;
    return nowValue;
  },
  parseProviderModel: (model: string) => {
    const [providerID, ...rest] = model.split("/");
    return {
      providerID,
      modelID: rest.join("/"),
    };
  },
  randomId: (prefix: string) => {
    idSequence += 1;
    return `${prefix}_${idSequence}`;
  },
}));

const { createPermissionRequest } = await import("./permissions");

function setTrustedTarget(
  modelId: string,
  provider: string,
  capabilities: string[] = ["text"],
) {
  trustedTargetsById.set(modelId, {
    modelId,
    modelName: `${modelId} name`,
    provider,
    capabilities,
  });
}

function addPendingRow(row: PendingRow) {
  pendingRows.push(row);
}

function addPendingPermission(
  origin: string,
  modelId: string,
  status: PermissionRow["status"] = "pending",
) {
  permissionRows.set(`${origin}::${modelId}`, {
    id: `${origin}::${modelId}`,
    origin,
    modelId,
    status,
    capabilities: [`cap:${modelId}`],
    updatedAt: 1,
  });
}

beforeEach(() => {
  pendingRows.length = 0;
  permissionRows.clear();
  originRows.clear();
  trustedTargetsById.clear();
  idSequence = 0;
  nowValue = 100;
});

afterAll(() => {
  mock.restore();
});

describe("createPermissionRequest", () => {
  it("returns an existing duplicate pending request", async () => {
    setTrustedTarget("openai/gpt-4o-mini", "openai");
    addPendingRow({
      id: "prm_existing",
      origin: TEST_ORIGIN,
      modelId: "openai/gpt-4o-mini",
      modelName: "GPT-4o mini",
      provider: "openai",
      capabilities: ["text"],
      requestedAt: 1,
      dismissed: false,
      status: "pending",
    });

    const result = await Effect.runPromise(createPermissionRequest({
      origin: TEST_ORIGIN,
      modelId: "openai/gpt-4o-mini",
      modelName: "spoofed",
      provider: "spoofed",
    }));

    expect(result).toEqual({
      status: "requested",
      request: pendingRows[0],
    });
    expect(pendingRows).toHaveLength(1);
  });

  it("rejects requests that exceed the per-origin cap", async () => {
    setTrustedTarget("openai/model-1", "openai");
    setTrustedTarget("openai/model-2", "openai");
    setTrustedTarget("openai/model-3", "openai");
    addPendingRow({
      id: "existing_1",
      origin: TEST_ORIGIN,
      modelId: "openai/model-1",
      modelName: "Model 1",
      provider: "openai",
      capabilities: ["text"],
      requestedAt: 1,
      dismissed: false,
      status: "pending",
    });
    addPendingRow({
      id: "existing_2",
      origin: TEST_ORIGIN,
      modelId: "openai/model-2",
      modelName: "Model 2",
      provider: "openai",
      capabilities: ["text"],
      requestedAt: 2,
      dismissed: false,
      status: "pending",
    });

    await expect(
      Effect.runPromise(createPermissionRequest({
        origin: TEST_ORIGIN,
        modelId: "openai/model-3",
        modelName: "Model 3",
        provider: "openai",
      })),
    ).rejects.toThrow(/Too many pending permission requests for origin/);

    expect(pendingRows.map((row) => row.id)).toEqual([
      "existing_1",
      "existing_2",
    ]);
  });

  it("rejects when the global cap is full without evicting older requests", async () => {
    setTrustedTarget("openai/model-1", "openai");
    setTrustedTarget("openai/model-2", "openai");
    setTrustedTarget("openai/model-3", "openai");
    setTrustedTarget("openai/model-4", "openai");
    addPendingRow({
      id: "existing_1",
      origin: "https://one.test",
      modelId: "openai/model-1",
      modelName: "Model 1",
      provider: "openai",
      capabilities: ["text"],
      requestedAt: 1,
      dismissed: false,
      status: "pending",
    });
    addPendingRow({
      id: "existing_2",
      origin: "https://two.test",
      modelId: "openai/model-2",
      modelName: "Model 2",
      provider: "openai",
      capabilities: ["text"],
      requestedAt: 2,
      dismissed: false,
      status: "pending",
    });
    addPendingRow({
      id: "existing_3",
      origin: "https://three.test",
      modelId: "openai/model-3",
      modelName: "Model 3",
      provider: "openai",
      capabilities: ["text"],
      requestedAt: 3,
      dismissed: false,
      status: "pending",
    });

    await expect(
      Effect.runPromise(createPermissionRequest({
        origin: "https://four.test",
        modelId: "openai/model-4",
        modelName: "Model 4",
        provider: "openai",
      })),
    ).rejects.toThrow(/Too many pending permission requests$/);

    expect(pendingRows.map((row) => row.id)).toEqual([
      "existing_1",
      "existing_2",
      "existing_3",
    ]);
  });

  it("retains older pending requests when checking the global cap", async () => {
    setTrustedTarget("openai/model-1", "openai");
    setTrustedTarget("openai/model-2", "openai");
    setTrustedTarget("openai/model-4", "openai");
    addPendingRow({
      id: "existing_1",
      origin: "https://one.test",
      modelId: "openai/model-1",
      modelName: "Model 1",
      provider: "openai",
      capabilities: ["text"],
      requestedAt: 1,
      dismissed: false,
      status: "pending",
    });
    addPendingRow({
      id: "existing_2",
      origin: "https://two.test",
      modelId: "openai/model-2",
      modelName: "Model 2",
      provider: "openai",
      capabilities: ["text"],
      requestedAt: 2,
      dismissed: false,
      status: "pending",
    });
    addPendingRow({
      id: "prm_stale",
      origin: "https://three.test",
      modelId: "openai/model-3",
      modelName: "Model 3",
      provider: "openai",
      capabilities: ["text"],
      requestedAt: 3,
      dismissed: false,
      status: "pending",
    });
    addPendingPermission("https://three.test", "openai/model-3");

    await expect(
      Effect.runPromise(createPermissionRequest({
        origin: "https://four.test",
        modelId: "openai/model-4",
        modelName: "Model 4",
        provider: "openai",
      })),
    ).rejects.toThrow(/Too many pending permission requests$/);

    expect(pendingRows.map((row) => row.id)).toEqual([
      "existing_1",
      "existing_2",
      "prm_stale",
    ]);
    expect(permissionRows.has("https://three.test::openai/model-3")).toBe(
      true,
    );
  });
});

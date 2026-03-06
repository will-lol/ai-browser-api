// @ts-expect-error bun:test types are not part of this package's TypeScript environment.
import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";

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
const publishedEvents: Array<{
  type: string;
  payload: {
    origin: string;
    requestIds?: string[];
    modelIds?: string[];
  };
}> = [];

let afterCommitEffects: Array<() => unknown | Promise<unknown>> = [];
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

mock.module("@/lib/runtime/constants", () => ({
  MAX_PENDING_REQUESTS,
  MAX_PENDING_REQUESTS_PER_ORIGIN,
  PENDING_REQUEST_TIMEOUT_MS: 30_000,
}));

mock.module("@/lib/runtime/db/runtime-db", () => ({
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

mock.module("@/lib/runtime/db/runtime-db-types", () => ({
  runtimePermissionKey: (origin: string, modelId: string) =>
    `${origin}::${modelId}`,
}));

mock.module("@/lib/runtime/db/runtime-db-tx", () => ({
  afterCommit: (effect: () => unknown | Promise<unknown>) => {
    afterCommitEffects.push(effect);
  },
  runTx: async (_tables: unknown[], fn: () => Promise<unknown>) => {
    const result = await fn();
    const effects = afterCommitEffects;
    afterCommitEffects = [];

    for (const effect of effects) {
      await effect();
    }

    return result;
  },
}));

mock.module("@/lib/runtime/events/runtime-events", () => ({
  publishRuntimeEvent: async (event: {
    type: string;
    payload: {
      origin: string;
      requestIds?: string[];
      modelIds?: string[];
    };
  }) => {
    publishedEvents.push(event);
  },
  subscribeRuntimeEvents: mock(() => () => undefined),
}));

mock.module("@/lib/runtime/permission-targets", () => ({
  resolveTrustedPermissionTargets: async (modelIds: string[]) =>
    new Map(
      modelIds.flatMap((modelId) => {
        const target = trustedTargetsById.get(modelId);
        return target ? [[modelId, target] as const] : [];
      }),
    ),
}));

mock.module("@/lib/runtime/permission-wait", () => ({
  waitForPermissionDecisionEventDriven: mock(async () => "resolved"),
}));

mock.module("@/lib/runtime/util", () => ({
  getModelCapabilities: (modelId: string) => [`cap:${modelId}`],
  now: () => {
    nowValue += 1;
    return nowValue;
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
  publishedEvents.length = 0;
  afterCommitEffects = [];
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

    const result = await createPermissionRequest({
      origin: TEST_ORIGIN,
      modelId: "openai/gpt-4o-mini",
      modelName: "spoofed",
      provider: "spoofed",
    });

    expect(result).toEqual({
      status: "requested",
      request: pendingRows[0],
    });
    expect(pendingRows).toHaveLength(1);
    expect(publishedEvents).toEqual([]);
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
      createPermissionRequest({
        origin: TEST_ORIGIN,
        modelId: "openai/model-3",
        modelName: "Model 3",
        provider: "openai",
      }),
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
      createPermissionRequest({
        origin: "https://four.test",
        modelId: "openai/model-4",
        modelName: "Model 4",
        provider: "openai",
      }),
    ).rejects.toThrow(/Too many pending permission requests$/);

    expect(pendingRows.map((row) => row.id)).toEqual([
      "existing_1",
      "existing_2",
      "existing_3",
    ]);
  });

  it("sanitizes stale requests before checking caps", async () => {
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

    const result = await createPermissionRequest({
      origin: "https://four.test",
      modelId: "openai/model-4",
      modelName: "Model 4",
      provider: "openai",
    });

    expect(result.status).toBe("requested");
    expect(pendingRows.map((row) => row.id)).toEqual([
      "existing_1",
      "existing_2",
      "prm_1",
    ]);
    expect(permissionRows.has("https://three.test::openai/model-3")).toBe(
      false,
    );
    expect(publishedEvents).toEqual([
      {
        type: "runtime.pending.changed",
        payload: {
          origin: "https://three.test",
          requestIds: ["prm_stale"],
        },
      },
      {
        type: "runtime.permissions.changed",
        payload: {
          origin: "https://three.test",
          modelIds: ["openai/model-3"],
        },
      },
      {
        type: "runtime.pending.changed",
        payload: {
          origin: "https://four.test",
          requestIds: ["prm_1"],
        },
      },
      {
        type: "runtime.permissions.changed",
        payload: {
          origin: "https://four.test",
          modelIds: ["openai/model-4"],
        },
      },
    ]);
  });
});

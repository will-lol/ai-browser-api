import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";

const TEST_ORIGIN = "https://example.test";
const STALE_MODEL_ID = "missing/model";
const DISCONNECTED_MODEL_ID = "anthropic/claude-sonnet";

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

const permissionRows = new Map<
  string,
  {
    id: string;
    origin: string;
    modelId: string;
    status: "allowed" | "denied" | "pending";
    capabilities: string[];
    updatedAt: number;
  }
>();

const deletedRequestIds: string[] = [];
const deletedPermissionIds: string[] = [];
const publishedEvents: Array<{
  type: string;
  payload: {
    origin: string;
    requestIds?: string[];
    modelIds?: string[];
  };
}> = [];

let afterCommitEffects: Array<() => unknown | Promise<unknown>> = [];

const permissionsGetMock = mock(async (id: string) => permissionRows.get(id));
const permissionsDeleteMock = mock(async (id: string) => {
  deletedPermissionIds.push(id);
  permissionRows.delete(id);
});

const permissionsPutMock = mock(
  async (value: {
    id: string;
    origin: string;
    modelId: string;
    status: "allowed" | "denied" | "pending";
    capabilities: string[];
    updatedAt: number;
  }) => {
    permissionRows.set(value.id, value);
  },
);

const pendingDeleteMock = mock(async (requestId: string) => {
  deletedRequestIds.push(requestId);
  const index = pendingRows.findIndex((row) => row.id === requestId);
  if (index >= 0) {
    pendingRows.splice(index, 1);
  }
});

const publishRuntimeEventMock = mock(
  async (event: {
    type: string;
    payload: {
      origin: string;
      requestIds?: string[];
      modelIds?: string[];
    };
  }) => {
    publishedEvents.push(event);
  },
);

mock.module("@/background/runtime/core/constants", () => ({
  MAX_PENDING_REQUESTS: 32,
  MAX_PENDING_REQUESTS_PER_ORIGIN: 10,
  PENDING_REQUEST_TIMEOUT_MS: 30_000,
}));

mock.module("@/background/storage/runtime-db", () => ({
  runtimeDb: {
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
      delete: pendingDeleteMock,
    },
    permissions: {
      get: permissionsGetMock,
      delete: permissionsDeleteMock,
      put: permissionsPutMock,
    },
  },
}));

mock.module("@/background/storage/runtime-db-types", () => ({
  runtimePermissionKey: (origin: string, modelId: string) =>
    `${origin}::${modelId}`,
}));

mock.module("@/background/storage/runtime-db-tx", () => ({
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

mock.module("@/app/events/runtime-events", () => ({
  publishRuntimeEvent: publishRuntimeEventMock,
  subscribeRuntimeEvents: mock(() => () => undefined),
}));

mock.module("@/background/runtime/permissions/permission-wait", () => ({
  mergePendingChangedRequestIds: (
    requestId: string,
    staleRequestIds: string[],
  ) => [requestId, ...staleRequestIds],
  waitForPermissionDecisionEventDriven: mock(async () => "resolved"),
}));

mock.module("@/background/runtime/permissions/permission-targets", () => ({
  resolveTrustedPermissionTargets: mock(async () => new Map()),
}));

mock.module("@/background/runtime/core/util", () => ({
  getModelCapabilities: (modelId: string) => [`cap:${modelId}`],
  isObject: (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === "object" && !Array.isArray(value),
  mergeRecord: <T extends Record<string, unknown>>(
    base: T,
    patch?: Record<string, unknown>,
  ) => ({ ...base, ...(patch ?? {}) }) as T,
  now: () => 123,
  parseProviderModel: (model: string) => {
    const [providerID, ...rest] = model.split("/");
    return {
      providerID,
      modelID: rest.join("/"),
    };
  },
  randomId: (prefix: string) => `${prefix}_1`,
}));

const { listPendingRequests, sanitizePendingPermissionRequests } =
  await import("./permissions");

beforeEach(() => {
  pendingRows.length = 0;
  permissionRows.clear();
  deletedRequestIds.length = 0;
  deletedPermissionIds.length = 0;
  publishedEvents.length = 0;
  afterCommitEffects = [];
  permissionsGetMock.mockClear();
  permissionsDeleteMock.mockClear();
  permissionsPutMock.mockClear();
  pendingDeleteMock.mockClear();
  publishRuntimeEventMock.mockClear();
});

afterAll(() => {
  mock.restore();
});

describe("sanitizePendingPermissionRequests", () => {
  it("removes unresolved pending requests and deletes pending permission state", async () => {
    pendingRows.push({
      id: "prm_stale",
      origin: TEST_ORIGIN,
      modelId: STALE_MODEL_ID,
      modelName: "Spoofed model",
      provider: "spoofed-provider",
      capabilities: ["vision"],
      requestedAt: 1,
      dismissed: false,
      status: "pending",
    });
    permissionRows.set(`${TEST_ORIGIN}::${STALE_MODEL_ID}`, {
      id: `${TEST_ORIGIN}::${STALE_MODEL_ID}`,
      origin: TEST_ORIGIN,
      modelId: STALE_MODEL_ID,
      status: "pending",
      capabilities: ["vision"],
      updatedAt: 1,
    });

    const removedRequestIds = await sanitizePendingPermissionRequests();

    expect(removedRequestIds).toEqual(["prm_stale"]);
    expect(Array.from(permissionRows.values())).toEqual([]);
    expect(deletedPermissionIds).toEqual([`${TEST_ORIGIN}::${STALE_MODEL_ID}`]);
    expect(deletedRequestIds).toEqual(["prm_stale"]);
    expect(publishedEvents).toEqual([
      {
        type: "runtime.pending.changed",
        payload: {
          origin: TEST_ORIGIN,
          requestIds: ["prm_stale"],
        },
      },
      {
        type: "runtime.permissions.changed",
        payload: {
          origin: TEST_ORIGIN,
          modelIds: [STALE_MODEL_ID],
        },
      },
    ]);
    expect(await listPendingRequests()).toEqual([]);
  });

  it("removes disconnected-provider requests without deleting non-pending permissions", async () => {
    pendingRows.push({
      id: "prm_disconnected",
      origin: TEST_ORIGIN,
      modelId: DISCONNECTED_MODEL_ID,
      modelName: "Claude Sonnet",
      provider: "anthropic",
      capabilities: ["text"],
      requestedAt: 1,
      dismissed: false,
      status: "pending",
    });
    permissionRows.set(`${TEST_ORIGIN}::${DISCONNECTED_MODEL_ID}`, {
      id: `${TEST_ORIGIN}::${DISCONNECTED_MODEL_ID}`,
      origin: TEST_ORIGIN,
      modelId: DISCONNECTED_MODEL_ID,
      status: "allowed",
      capabilities: ["text"],
      updatedAt: 1,
    });

    const removedRequestIds = await sanitizePendingPermissionRequests();

    expect(removedRequestIds).toEqual(["prm_disconnected"]);
    expect(Array.from(permissionRows.values())).toEqual([
      {
        id: `${TEST_ORIGIN}::${DISCONNECTED_MODEL_ID}`,
        origin: TEST_ORIGIN,
        modelId: DISCONNECTED_MODEL_ID,
        status: "allowed",
        capabilities: ["text"],
        updatedAt: 1,
      },
    ]);
    expect(deletedPermissionIds).toEqual([]);
    expect(deletedRequestIds).toEqual(["prm_disconnected"]);
    expect(publishedEvents).toEqual([
      {
        type: "runtime.pending.changed",
        payload: {
          origin: TEST_ORIGIN,
          requestIds: ["prm_disconnected"],
        },
      },
      {
        type: "runtime.permissions.changed",
        payload: {
          origin: TEST_ORIGIN,
          modelIds: [DISCONNECTED_MODEL_ID],
        },
      },
    ]);
  });
});

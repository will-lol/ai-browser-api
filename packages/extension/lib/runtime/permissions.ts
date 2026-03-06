import { RuntimeValidationError } from "@llm-bridge/contracts";
import {
  MAX_PENDING_REQUESTS,
  MAX_PENDING_REQUESTS_PER_ORIGIN,
  PENDING_REQUEST_TIMEOUT_MS,
} from "@/lib/runtime/constants";
import { runtimeDb } from "@/lib/runtime/db/runtime-db";
import { runtimePermissionKey } from "@/lib/runtime/db/runtime-db-types";
import { afterCommit, runTx } from "@/lib/runtime/db/runtime-db-tx";
import {
  publishRuntimeEvent,
  subscribeRuntimeEvents,
} from "@/lib/runtime/events/runtime-events";
import {
  waitForPermissionDecisionEventDriven,
  type PermissionDecisionWaitResult,
} from "@/lib/runtime/permission-wait";
import { resolveTrustedPermissionTargets } from "@/lib/runtime/permission-targets";
import { getModelCapabilities, now, randomId } from "@/lib/runtime/util";

export type PermissionStatus = "allowed" | "denied" | "pending";

export interface PermissionRequest {
  id: string;
  origin: string;
  modelId: string;
  modelName: string;
  provider: string;
  capabilities: string[];
  requestedAt: number;
  dismissed: boolean;
  status: "pending" | "resolved";
}

export type CreatePermissionRequestResult =
  | {
      status: "alreadyAllowed";
    }
  | {
      status: "requested";
      request: PermissionRequest;
    };

async function isPermissionRequestPending(requestId: string) {
  const pending = await runtimeDb.pendingRequests.get(requestId);
  return pending?.status === "pending";
}

export async function listPermissions(origin: string) {
  const rows = await runtimeDb.permissions
    .where("origin")
    .equals(origin)
    .toArray();
  return rows.map((row) => ({
    modelId: row.modelId,
    status: row.status,
    capabilities: row.capabilities,
    updatedAt: row.updatedAt,
  }));
}

function toRuleMap(input: Awaited<ReturnType<typeof listPermissions>>) {
  return Object.fromEntries(input.map((rule) => [rule.modelId, rule] as const));
}

export async function getOriginPermissions(origin: string) {
  const [originRow, rules] = await Promise.all([
    runtimeDb.origins.get(origin),
    listPermissions(origin),
  ]);

  return {
    enabled: originRow?.enabled ?? true,
    rules: toRuleMap(rules),
  };
}

export async function setOriginEnabled(origin: string, enabled: boolean) {
  await runTx([runtimeDb.origins], async () => {
    await runtimeDb.origins.put({
      origin,
      enabled,
      updatedAt: now(),
    });

    afterCommit(async () => {
      await publishRuntimeEvent({
        type: "runtime.origin.changed",
        payload: { origin },
      });
    });
  });
}

export async function setModelPermission(
  origin: string,
  modelId: string,
  status: PermissionStatus,
  capabilities?: string[],
) {
  const updatedAt = now();

  await runTx([runtimeDb.permissions], async () => {
    const existing = await runtimeDb.permissions.get(
      runtimePermissionKey(origin, modelId),
    );
    await runtimeDb.permissions.put({
      id: runtimePermissionKey(origin, modelId),
      origin,
      modelId,
      status,
      capabilities:
        capabilities ?? existing?.capabilities ?? getModelCapabilities(modelId),
      updatedAt,
    });

    afterCommit(async () => {
      await publishRuntimeEvent({
        type: "runtime.permissions.changed",
        payload: {
          origin,
          modelIds: [modelId],
        },
      });
    });
  });
}

export async function getModelPermission(
  origin: string,
  modelId: string,
): Promise<PermissionStatus> {
  const [originState, permission] = await Promise.all([
    runtimeDb.origins.get(origin),
    runtimeDb.permissions.get(runtimePermissionKey(origin, modelId)),
  ]);

  if (originState && !originState.enabled) return "denied";
  return permission?.status ?? "denied";
}

export async function createPermissionRequest(input: {
  origin: string;
  modelId: string;
  provider: string;
  modelName: string;
  capabilities?: string[];
}): Promise<CreatePermissionRequestResult> {
  await sanitizePendingPermissionRequests();

  const permission = await getModelPermission(input.origin, input.modelId);
  if (permission === "allowed") {
    return {
      status: "alreadyAllowed",
    };
  }

  const capabilities =
    input.capabilities ?? getModelCapabilities(input.modelId);
  let result: CreatePermissionRequestResult | undefined;

  await runTx([runtimeDb.pendingRequests, runtimeDb.permissions], async () => {
    const duplicate = await runtimeDb.pendingRequests
      .where("origin")
      .equals(input.origin)
      .filter(
        (item) =>
          item.modelId === input.modelId &&
          item.status === "pending" &&
          !item.dismissed,
      )
      .first();
    if (duplicate) {
      result = {
        status: "requested",
        request: duplicate,
      };
      return;
    }

    const originPendingCount = await runtimeDb.pendingRequests
      .where("origin")
      .equals(input.origin)
      .filter((item) => item.status === "pending" && !item.dismissed)
      .count();
    if (originPendingCount >= MAX_PENDING_REQUESTS_PER_ORIGIN) {
      throw new RuntimeValidationError({
        message: `Too many pending permission requests for origin ${input.origin}`,
      });
    }

    const totalPendingCount = await runtimeDb.pendingRequests
      .where("status")
      .equals("pending")
      .filter((item) => !item.dismissed)
      .count();
    if (totalPendingCount >= MAX_PENDING_REQUESTS) {
      throw new RuntimeValidationError({
        message: "Too many pending permission requests",
      });
    }

    const updatedAt = now();
    const request: PermissionRequest = {
      id: randomId("prm"),
      origin: input.origin,
      modelId: input.modelId,
      provider: input.provider,
      modelName: input.modelName,
      capabilities,
      requestedAt: updatedAt,
      dismissed: false,
      status: "pending",
    };

    await runtimeDb.permissions.put({
      id: runtimePermissionKey(input.origin, input.modelId),
      origin: input.origin,
      modelId: input.modelId,
      status: "pending",
      capabilities,
      updatedAt,
    });

    await runtimeDb.pendingRequests.put(request);

    afterCommit(async () => {
      await publishRuntimeEvent({
        type: "runtime.pending.changed",
        payload: {
          origin: input.origin,
          requestIds: [request.id],
        },
      });
      await publishRuntimeEvent({
        type: "runtime.permissions.changed",
        payload: {
          origin: input.origin,
          modelIds: [input.modelId],
        },
      });
    });

    result = {
      status: "requested",
      request,
    };
  });

  if (result) {
    return result;
  }

  throw new RuntimeValidationError({
    message: "Permission request creation did not complete",
  });
}

export async function dismissPermissionRequest(requestId: string) {
  await runTx([runtimeDb.pendingRequests, runtimeDb.permissions], async () => {
    const match = await runtimeDb.pendingRequests.get(requestId);
    if (!match) return;

    await runtimeDb.permissions.put({
      id: runtimePermissionKey(match.origin, match.modelId),
      origin: match.origin,
      modelId: match.modelId,
      status: "denied",
      capabilities: match.capabilities,
      updatedAt: now(),
    });

    await runtimeDb.pendingRequests.delete(requestId);

    afterCommit(async () => {
      await publishRuntimeEvent({
        type: "runtime.pending.changed",
        payload: {
          origin: match.origin,
          requestIds: [requestId],
        },
      });
      await publishRuntimeEvent({
        type: "runtime.permissions.changed",
        payload: {
          origin: match.origin,
          modelIds: [match.modelId],
        },
      });
    });
  });
}

export async function resolvePermissionRequest(
  requestId: string,
  decision: "allowed" | "denied",
) {
  await runTx([runtimeDb.pendingRequests, runtimeDb.permissions], async () => {
    const match = await runtimeDb.pendingRequests.get(requestId);
    if (!match) return;

    await runtimeDb.permissions.put({
      id: runtimePermissionKey(match.origin, match.modelId),
      origin: match.origin,
      modelId: match.modelId,
      status: decision,
      capabilities: match.capabilities,
      updatedAt: now(),
    });

    await runtimeDb.pendingRequests.delete(requestId);

    afterCommit(async () => {
      await publishRuntimeEvent({
        type: "runtime.pending.changed",
        payload: {
          origin: match.origin,
          requestIds: [requestId],
        },
      });
      await publishRuntimeEvent({
        type: "runtime.permissions.changed",
        payload: {
          origin: match.origin,
          modelIds: [match.modelId],
        },
      });
    });
  });
}

export async function listPendingRequests(origin?: string) {
  const rows = await runtimeDb.pendingRequests
    .where("status")
    .equals("pending")
    .filter((item) => {
      if (item.dismissed) return false;
      if (!origin) return true;
      return item.origin === origin;
    })
    .toArray();

  return rows;
}

export async function sanitizePendingPermissionRequests() {
  const rows = await listPendingRequests();
  if (rows.length === 0) {
    return [];
  }

  const trustedTargets = await resolveTrustedPermissionTargets(
    rows.map((row) => row.modelId),
  );
  const staleRows = rows.filter((row) => !trustedTargets.has(row.modelId));

  if (staleRows.length === 0) {
    return [];
  }

  const pendingChanged = new Map<string, string[]>();
  const permissionChanged = new Map<string, Set<string>>();
  await runTx([runtimeDb.pendingRequests, runtimeDb.permissions], async () => {
    for (const row of staleRows) {
      const permission = await runtimeDb.permissions.get(
        runtimePermissionKey(row.origin, row.modelId),
      );
      if (permission?.status === "pending") {
        await runtimeDb.permissions.delete(permission.id);
      }
      await runtimeDb.pendingRequests.delete(row.id);

      const requestIds = pendingChanged.get(row.origin) ?? [];
      requestIds.push(row.id);
      pendingChanged.set(row.origin, requestIds);

      const modelIds = permissionChanged.get(row.origin) ?? new Set<string>();
      modelIds.add(row.modelId);
      permissionChanged.set(row.origin, modelIds);
    }

    afterCommit(async () => {
      for (const [origin, requestIds] of pendingChanged) {
        await publishRuntimeEvent({
          type: "runtime.pending.changed",
          payload: {
            origin,
            requestIds,
          },
        });
      }

      for (const [origin, modelIds] of permissionChanged) {
        await publishRuntimeEvent({
          type: "runtime.permissions.changed",
          payload: {
            origin,
            modelIds: Array.from(modelIds),
          },
        });
      }
    });
  });

  return staleRows.map((row) => row.id);
}

export async function waitForPermissionDecision(
  requestId: string,
  timeoutMs = PENDING_REQUEST_TIMEOUT_MS,
  signal?: AbortSignal,
): Promise<PermissionDecisionWaitResult> {
  return await waitForPermissionDecisionEventDriven({
    requestId,
    timeoutMs,
    signal,
    isPending: isPermissionRequestPending,
    subscribe: subscribeRuntimeEvents,
  });
}

import {
  RuntimeValidationError,
  isRuntimeRpcError,
} from "@llm-bridge/contracts";
import * as Effect from "effect/Effect";
import {
  MAX_PENDING_REQUESTS,
  MAX_PENDING_REQUESTS_PER_ORIGIN,
  PENDING_REQUEST_TIMEOUT_MS,
} from "@/background/runtime/core/constants";
import { runtimeDb } from "@/background/storage/runtime-db";
import { runtimePermissionKey } from "@/background/storage/runtime-db-types";
import { afterCommit, runTx } from "@/background/storage/runtime-db-tx";
import {
  publishRuntimeEvent,
  subscribeRuntimeEvents,
} from "@/app/events/runtime-events";
import {
  waitForPermissionDecisionEventDriven,
  type PermissionDecisionWaitResult,
} from "@/background/runtime/permissions/permission-wait";
import { resolveTrustedPermissionTargets } from "@/background/runtime/permissions/permission-targets";
import { getModelCapabilities, now, randomId } from "@/background/runtime/core/util";

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

type CreatePermissionRequestResult =
  | {
      status: "alreadyAllowed";
    }
  | {
      status: "requested";
      request: PermissionRequest;
    };

function isPermissionRequestPending(requestId: string) {
  return Effect.promise(() => runtimeDb.pendingRequests.get(requestId)).pipe(
    Effect.map((pending) => pending?.status === "pending"),
  );
}

export function listPermissions(origin: string) {
  return Effect.promise(() =>
    runtimeDb.permissions.where("origin").equals(origin).toArray(),
  ).pipe(
    Effect.map((rows) =>
      rows.map((row) => ({
        modelId: row.modelId,
        status: row.status,
        capabilities: row.capabilities,
        updatedAt: row.updatedAt,
      })),
    ),
  );
}

function toRuleMap(
  input: Array<{
    modelId: string;
    status: PermissionStatus;
    capabilities: string[];
    updatedAt: number;
  }>,
) {
  return Object.fromEntries(
    input.map((rule) => [rule.modelId, rule] as const),
  );
}

export function getOriginPermissions(origin: string) {
  return Effect.all([
    Effect.promise(() => runtimeDb.origins.get(origin)),
    listPermissions(origin),
  ]).pipe(
    Effect.map(([originRow, rules]) => ({
      enabled: originRow?.enabled ?? true,
      rules: toRuleMap(rules),
    })),
  );
}

export function setOriginEnabled(origin: string, enabled: boolean) {
  return Effect.promise(() =>
    runTx([runtimeDb.origins], async () => {
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
    }),
  );
}

export function setModelPermission(
  origin: string,
  modelId: string,
  status: PermissionStatus,
  capabilities?: string[],
) {
  const updatedAt = now();

  return Effect.promise(() =>
    runTx([runtimeDb.permissions], async () => {
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
    }),
  );
}

export function getModelPermission(
  origin: string,
  modelId: string,
): Effect.Effect<PermissionStatus> {
  return Effect.all([
    Effect.promise(() => runtimeDb.origins.get(origin)),
    Effect.promise(() =>
      runtimeDb.permissions.get(runtimePermissionKey(origin, modelId)),
    ),
  ]).pipe(
    Effect.map(([originState, permission]) => {
      if (originState && !originState.enabled) return "denied";
      return permission?.status ?? "denied";
    }),
  );
}

export function createPermissionRequest(input: {
  origin: string;
  modelId: string;
  provider: string;
  modelName: string;
  capabilities?: string[];
}) {
  return Effect.promise(async () => {
    await Effect.runPromise(sanitizePendingPermissionRequests());

    const permission = await Effect.runPromise(
      getModelPermission(input.origin, input.modelId),
    );
    if (permission === "allowed") {
      return {
        status: "alreadyAllowed",
      } satisfies CreatePermissionRequestResult;
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
  }).pipe(
    Effect.catchAllDefect((defect) =>
      isRuntimeRpcError(defect) ? Effect.fail(defect) : Effect.die(defect),
    ),
  );
}

export function dismissPermissionRequest(requestId: string) {
  return Effect.promise(() =>
    runTx([runtimeDb.pendingRequests, runtimeDb.permissions], async () => {
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
    }),
  );
}

export function resolvePermissionRequest(
  requestId: string,
  decision: "allowed" | "denied",
) {
  return Effect.promise(() =>
    runTx([runtimeDb.pendingRequests, runtimeDb.permissions], async () => {
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
    }),
  );
}

export function listPendingRequests(origin?: string) {
  return Effect.promise(() =>
    runtimeDb.pendingRequests
      .where("status")
      .equals("pending")
      .filter((item) => {
        if (item.dismissed) return false;
        if (!origin) return true;
        return item.origin === origin;
      })
      .toArray(),
  );
}

export function sanitizePendingPermissionRequests() {
  return Effect.gen(function* () {
    const rows = yield* listPendingRequests();
    if (rows.length === 0) {
      return [];
    }

    const trustedTargets = yield* resolveTrustedPermissionTargets(
      rows.map((row) => row.modelId),
    );
    const staleRows = rows.filter((row) => !trustedTargets.has(row.modelId));

    if (staleRows.length === 0) {
      return [];
    }

    const pendingChanged = new Map<string, string[]>();
    const permissionChanged = new Map<string, Set<string>>();
    yield* Effect.promise(() =>
      runTx([runtimeDb.pendingRequests, runtimeDb.permissions], async () => {
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
      }),
    );

    return staleRows.map((row) => row.id);
  });
}

export function waitForPermissionDecision(
  requestId: string,
  timeoutMs = PENDING_REQUEST_TIMEOUT_MS,
  signal?: AbortSignal,
): Effect.Effect<PermissionDecisionWaitResult> {
  return waitForPermissionDecisionEventDriven({
    requestId,
    timeoutMs,
    signal,
    isPending: (nextRequestId) =>
      Effect.runPromise(isPermissionRequestPending(nextRequestId)),
    subscribe: subscribeRuntimeEvents,
  });
}

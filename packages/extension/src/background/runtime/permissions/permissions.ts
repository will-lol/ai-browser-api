import {
  RuntimeValidationError,
  isRuntimeRpcError,
} from "@llm-bridge/contracts";
import * as Effect from "effect/Effect";
import {
  MAX_PENDING_REQUESTS,
  MAX_PENDING_REQUESTS_PER_ORIGIN,
} from "@/background/runtime/core/constants";
import { runtimeDb } from "@/background/storage/runtime-db";
import { runtimePermissionKey } from "@/background/storage/runtime-db-types";
import { runTx } from "@/background/storage/runtime-db-tx";
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

export type CreatePermissionRequestResult =
  | {
      status: "alreadyAllowed";
    }
  | {
      status: "requested";
      request: PermissionRequest;
    };

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
  return Effect.gen(function* () {
    const [originRow, rules] = yield* Effect.all([
      Effect.promise(() => runtimeDb.origins.get(origin)),
      listPermissions(origin),
    ]);

    return {
      enabled: originRow?.enabled ?? true,
      rules: toRuleMap(rules),
    };
  });
}

export function setOriginEnabled(origin: string, enabled: boolean) {
  return Effect.promise(() =>
    runTx([runtimeDb.origins], async () => {
      await runtimeDb.origins.put({
        origin,
        enabled,
        updatedAt: now(),
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
    }),
  );
}

export function getModelPermission(
  origin: string,
  modelId: string,
): Effect.Effect<PermissionStatus> {
  return Effect.gen(function* () {
    const [originState, permission] = yield* Effect.all([
      Effect.promise(() => runtimeDb.origins.get(origin)),
      Effect.promise(() =>
        runtimeDb.permissions.get(runtimePermissionKey(origin, modelId)),
      ),
    ]);

    if (originState && !originState.enabled) return "denied";
    return permission?.status ?? "denied";
  });
}

export function createPermissionRequest(input: {
  origin: string;
  modelId: string;
  provider: string;
  modelName: string;
  capabilities?: string[];
}) {
  return Effect.gen(function* () {
    const permission = yield* getModelPermission(input.origin, input.modelId);
    if (permission === "allowed") {
      return {
        status: "alreadyAllowed",
      } satisfies CreatePermissionRequestResult;
    }

    const capabilities =
      input.capabilities ?? getModelCapabilities(input.modelId);
    return yield* Effect.tryPromise({
      try: () =>
        runTx([runtimeDb.pendingRequests, runtimeDb.permissions], async () => {
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
            return {
              status: "requested",
              request: duplicate,
            } satisfies CreatePermissionRequestResult;
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

          return {
            status: "requested",
            request,
          } satisfies CreatePermissionRequestResult;
        }),
      catch: (error) => error,
    }).pipe(
      Effect.catchAll((error) =>
        isRuntimeRpcError(error) ? Effect.fail(error) : Effect.die(error),
      ),
    );
  });
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
    }),
  );
}

export function listPendingRequests(origin?: string) {
  return Effect.gen(function* () {
    return yield* Effect.promise(() =>
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
  });
}

export function getPendingRequest(requestId: string) {
  return Effect.promise(() => runtimeDb.pendingRequests.get(requestId));
}

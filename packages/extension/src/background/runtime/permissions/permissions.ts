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
  return runTx([runtimeDb.origins], () =>
    Effect.tryPromise({
      try: () =>
        runtimeDb.origins.put({
          origin,
          enabled,
          updatedAt: now(),
        }),
      catch: (error) => error,
    }).pipe(Effect.asVoid),
  );
}

export function setModelPermission(
  origin: string,
  modelId: string,
  status: PermissionStatus,
  capabilities?: string[],
) {
  const updatedAt = now();

  return runTx([runtimeDb.permissions], () =>
    Effect.gen(function* () {
      const existing = yield* Effect.tryPromise({
        try: () =>
          runtimeDb.permissions.get(runtimePermissionKey(origin, modelId)),
        catch: (error) => error,
      });

      yield* Effect.tryPromise({
        try: () =>
          runtimeDb.permissions.put({
            id: runtimePermissionKey(origin, modelId),
            origin,
            modelId,
            status,
            capabilities:
              capabilities ??
              existing?.capabilities ??
              getModelCapabilities(modelId),
            updatedAt,
          }),
        catch: (error) => error,
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
    return yield* runTx([runtimeDb.pendingRequests, runtimeDb.permissions], () =>
      Effect.gen(function* () {
        const duplicate = yield* Effect.tryPromise({
          try: () =>
            runtimeDb.pendingRequests
              .where("origin")
              .equals(input.origin)
              .filter(
                (item) =>
                  item.modelId === input.modelId &&
                  item.status === "pending" &&
                  !item.dismissed,
              )
              .first(),
          catch: (error) => error,
        });

        if (duplicate) {
          return {
            status: "requested",
            request: duplicate,
          } satisfies CreatePermissionRequestResult;
        }

        const originPendingCount = yield* Effect.tryPromise({
          try: () =>
            runtimeDb.pendingRequests
              .where("origin")
              .equals(input.origin)
              .filter((item) => item.status === "pending" && !item.dismissed)
              .count(),
          catch: (error) => error,
        });
        if (originPendingCount >= MAX_PENDING_REQUESTS_PER_ORIGIN) {
          return yield* new RuntimeValidationError({
            message: `Too many pending permission requests for origin ${input.origin}`,
          });
        }

        const totalPendingCount = yield* Effect.tryPromise({
          try: () =>
            runtimeDb.pendingRequests
              .where("status")
              .equals("pending")
              .filter((item) => !item.dismissed)
              .count(),
          catch: (error) => error,
        });
        if (totalPendingCount >= MAX_PENDING_REQUESTS) {
          return yield* new RuntimeValidationError({
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

        yield* Effect.tryPromise({
          try: () =>
            runtimeDb.permissions.put({
              id: runtimePermissionKey(input.origin, input.modelId),
              origin: input.origin,
              modelId: input.modelId,
              status: "pending",
              capabilities,
              updatedAt,
            }),
          catch: (error) => error,
        });

        yield* Effect.tryPromise({
          try: () => runtimeDb.pendingRequests.put(request),
          catch: (error) => error,
        });

        return {
          status: "requested",
          request,
        } satisfies CreatePermissionRequestResult;
      }),
    ).pipe(
      Effect.catchAll((error) =>
        isRuntimeRpcError(error) ? Effect.fail(error) : Effect.die(error),
      ),
    );
  });
}

export function dismissPermissionRequest(requestId: string) {
  return runTx([runtimeDb.pendingRequests, runtimeDb.permissions], () =>
    Effect.gen(function* () {
      const match = yield* Effect.tryPromise({
        try: () => runtimeDb.pendingRequests.get(requestId),
        catch: (error) => error,
      });
      if (!match) return;

      yield* Effect.tryPromise({
        try: () =>
          runtimeDb.permissions.put({
            id: runtimePermissionKey(match.origin, match.modelId),
            origin: match.origin,
            modelId: match.modelId,
            status: "denied",
            capabilities: match.capabilities,
            updatedAt: now(),
          }),
        catch: (error) => error,
      });

      yield* Effect.tryPromise({
        try: () => runtimeDb.pendingRequests.delete(requestId),
        catch: (error) => error,
      });
    }),
  );
}

export function resolvePermissionRequest(
  requestId: string,
  decision: "allowed" | "denied",
) {
  return runTx([runtimeDb.pendingRequests, runtimeDb.permissions], () =>
    Effect.gen(function* () {
      const match = yield* Effect.tryPromise({
        try: () => runtimeDb.pendingRequests.get(requestId),
        catch: (error) => error,
      });
      if (!match) return;

      yield* Effect.tryPromise({
        try: () =>
          runtimeDb.permissions.put({
            id: runtimePermissionKey(match.origin, match.modelId),
            origin: match.origin,
            modelId: match.modelId,
            status: decision,
            capabilities: match.capabilities,
            updatedAt: now(),
          }),
        catch: (error) => error,
      });

      yield* Effect.tryPromise({
        try: () => runtimeDb.pendingRequests.delete(requestId),
        catch: (error) => error,
      });
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

import {
  PermissionsService,
  type PermissionsServiceApi,
} from "@llm-bridge/runtime-core";
import type {
  RuntimeOriginState,
  RuntimePendingRequest,
  RuntimePermissionEntry,
} from "@llm-bridge/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { PENDING_REQUEST_TIMEOUT_MS } from "@/background/runtime/core/constants";
import { runtimeDb } from "@/background/storage/runtime-db";
import {
  createPermissionRequest,
  dismissPermissionRequest,
  getModelPermission,
  getPendingRequest,
  resolvePermissionRequest,
  setModelPermission,
  setOriginEnabled,
} from "@/background/runtime/permissions";

function sameSnapshot<A>(left: A, right: A) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function toOriginStateMap(
  rows: ReadonlyArray<{
    origin: string;
    enabled: boolean;
  }>,
): ReadonlyMap<string, RuntimeOriginState> {
  return new Map(
    rows.map((row) => [
      row.origin,
      {
        origin: row.origin,
        enabled: row.enabled,
      },
    ]),
  );
}

async function loadModelRows(modelIds: ReadonlyArray<string>) {
  if (modelIds.length === 0) {
    return new Map<string, Awaited<ReturnType<typeof runtimeDb.models.bulkGet>>[number]>();
  }

  const rows = await runtimeDb.models.bulkGet([...modelIds]);
  return new Map(
    rows
      .filter((row): row is NonNullable<typeof row> => row != null)
      .map((row) => [row.id, row] as const),
  );
}

async function buildPermissionsMap() {
  const rows = await runtimeDb.permissions.toArray();
  const modelRows = await loadModelRows(rows.map((row) => row.modelId));
  const grouped = new Map<string, Array<RuntimePermissionEntry>>();

  for (const row of rows) {
    const modelRow = modelRows.get(row.modelId);
    const fallbackProvider = row.modelId.split("/")[0] ?? "unknown";
    const fallbackName = row.modelId.split("/")[1] ?? row.modelId;
    const entries = grouped.get(row.origin) ?? [];
    entries.push({
      modelId: row.modelId,
      modelName: modelRow?.info.name ?? fallbackName,
      provider: modelRow?.providerID ?? fallbackProvider,
      status: row.status,
      capabilities: modelRow?.capabilities ?? row.capabilities,
      requestedAt: row.updatedAt,
    });
    grouped.set(row.origin, entries);
  }

  return new Map(
    Array.from(grouped.entries()).map(([origin, entries]) => [
      origin,
      entries.sort((left, right) => left.modelName.localeCompare(right.modelName)),
    ]),
  );
}

async function buildPendingMap() {
  const rows = await runtimeDb.pendingRequests
    .where("status")
    .equals("pending")
    .filter((item) => !item.dismissed)
    .toArray();
  const grouped = new Map<string, Array<RuntimePendingRequest>>();

  for (const row of rows) {
    const entries = grouped.get(row.origin) ?? [];
    entries.push({
      id: row.id,
      origin: row.origin,
      modelId: row.modelId,
      modelName: row.modelName,
      provider: row.provider,
      capabilities: row.capabilities,
      requestedAt: row.requestedAt,
      dismissed: row.dismissed,
      status: row.status,
    });
    grouped.set(row.origin, entries);
  }

  return new Map(
    Array.from(grouped.entries()).map(([origin, entries]) => [
      origin,
      entries.sort((left, right) => left.requestedAt - right.requestedAt),
    ]),
  );
}

export const PermissionsServiceLive = Layer.effect(
  PermissionsService,
  Effect.gen(function* () {
    const originStatesRef = yield* SubscriptionRef.make<
      ReadonlyMap<string, RuntimeOriginState>
    >(new Map());
    const permissionsRef = yield* SubscriptionRef.make<
      ReadonlyMap<string, ReadonlyArray<RuntimePermissionEntry>>
    >(new Map());
    const pendingRef = yield* SubscriptionRef.make<
      ReadonlyMap<string, ReadonlyArray<RuntimePendingRequest>>
    >(new Map());
    const waiters = new Map<string, Deferred.Deferred<void>>();

    const refreshSnapshots = Effect.gen(function* () {
      const [originRows, permissionsMap, pendingMap] = yield* Effect.all([
        Effect.promise(() => runtimeDb.origins.toArray()),
        Effect.promise(() => buildPermissionsMap()),
        Effect.promise(() => buildPendingMap()),
      ]);

      yield* SubscriptionRef.set(originStatesRef, toOriginStateMap(originRows));
      yield* SubscriptionRef.set(permissionsRef, permissionsMap);
      yield* SubscriptionRef.set(pendingRef, pendingMap);
    });

    const getOrCreateWaiter = (requestId: string) =>
      Effect.gen(function* () {
        const existing = waiters.get(requestId);
        if (existing) {
          return existing;
        }
        const waiter = yield* Deferred.make<void>();
        waiters.set(requestId, waiter);
        return waiter;
      });

    const completeWaiter = (requestId: string) =>
      Effect.gen(function* () {
        const waiter = waiters.get(requestId);
        if (!waiter) return;
        waiters.delete(requestId);
        yield* Deferred.succeed(waiter, undefined).pipe(
          Effect.catchAll(() => Effect.void),
        );
      });

    yield* refreshSnapshots;

    return {
      getOriginState: (origin: string) =>
        SubscriptionRef.get(originStatesRef).pipe(
          Effect.map(
            (states) =>
              states.get(origin) ?? {
                origin,
                enabled: true,
              },
          ),
        ),
      streamOriginState: (origin: string) =>
        originStatesRef.changes.pipe(
          Stream.map(
            (states) =>
              states.get(origin) ?? {
                origin,
                enabled: true,
              },
          ),
          Stream.changesWith(sameSnapshot),
        ),
      listPermissions: (origin: string) =>
        SubscriptionRef.get(permissionsRef).pipe(
          Effect.map((entries) => entries.get(origin) ?? []),
        ),
      streamPermissions: (origin: string) =>
        permissionsRef.changes.pipe(
          Stream.map((entries) => entries.get(origin) ?? []),
          Stream.changesWith(sameSnapshot),
        ),
      getModelPermission,
      setOriginEnabled: (origin: string, enabled: boolean) =>
        setOriginEnabled(origin, enabled).pipe(
          Effect.zipRight(refreshSnapshots),
          Effect.as({
            origin,
            enabled,
          }),
        ),
      setModelPermission: (input) =>
        setModelPermission(
          input.origin,
          input.modelID,
          input.status,
          input.capabilities ? Array.from(input.capabilities) : undefined,
        ).pipe(
          Effect.zipRight(refreshSnapshots),
          Effect.as({
            origin: input.origin,
            modelId: input.modelID,
            status: input.status,
          }),
        ),
      createPermissionRequest: (input) =>
        createPermissionRequest({
          ...input,
          capabilities: input.capabilities
            ? Array.from(input.capabilities)
            : undefined,
        }).pipe(Effect.tap(() => refreshSnapshots)),
      resolvePermissionRequest: (input) =>
        resolvePermissionRequest(input.requestId, input.decision).pipe(
          Effect.zipRight(refreshSnapshots),
          Effect.zipRight(completeWaiter(input.requestId)),
          Effect.as({
            requestId: input.requestId,
            decision: input.decision,
          }),
        ),
      dismissPermissionRequest: (requestId: string) =>
        dismissPermissionRequest(requestId).pipe(
          Effect.zipRight(refreshSnapshots),
          Effect.zipRight(completeWaiter(requestId)),
          Effect.as({
            requestId,
          }),
        ),
      listPending: (origin: string) =>
        SubscriptionRef.get(pendingRef).pipe(
          Effect.map((entries) => entries.get(origin) ?? []),
        ),
      streamPending: (origin: string) =>
        pendingRef.changes.pipe(
          Stream.map((entries) => entries.get(origin) ?? []),
          Stream.changesWith(sameSnapshot),
        ),
      waitForPermissionDecision: (
        requestId: string,
        timeoutMs = PENDING_REQUEST_TIMEOUT_MS,
        signal?: AbortSignal,
      ) =>
        Effect.promise(async () => {
          const pending = await Effect.runPromise(
            getPendingRequest(requestId).pipe(
              Effect.map((request) => request?.status === "pending"),
            ),
          );
          if (!pending) {
            return "resolved" as const;
          }

          const waiter = await Effect.runPromise(getOrCreateWaiter(requestId));

          return await new Promise<"resolved" | "timeout" | "aborted">(
            (resolve) => {
              let settled = false;
              const onAbort = () => finalize("aborted");
              const timeoutId = setTimeout(() => {
                finalize("timeout");
              }, timeoutMs);

              function finalize(
                result: "resolved" | "timeout" | "aborted",
              ) {
                if (settled) return;
                settled = true;
                clearTimeout(timeoutId);
                signal?.removeEventListener("abort", onAbort);
                resolve(result);
              }

              signal?.addEventListener("abort", onAbort, { once: true });
              if (signal?.aborted) {
                finalize("aborted");
                return;
              }

              void Effect.runPromise(Deferred.await(waiter))
                .then(() => finalize("resolved"))
                .catch(() => undefined);
            },
          );
        }),
      streamOriginStates: () =>
        originStatesRef.changes.pipe(
          Stream.changesWith(sameSnapshot),
        ),
      streamPermissionsMap: () =>
        permissionsRef.changes.pipe(
          Stream.changesWith(sameSnapshot),
        ),
      streamPendingMap: () =>
        pendingRef.changes.pipe(
          Stream.changesWith(sameSnapshot),
        ),
    } satisfies PermissionsServiceApi;
  }),
);

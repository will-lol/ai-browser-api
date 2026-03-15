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
import {
  replaceIfChanged,
  sameArray,
  sameMap,
} from "@/background/services/service-snapshot-utils";
import { parseProviderModel } from "@/background/runtime/core/util";
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

type PermissionsSnapshot = {
  readonly originStates: ReadonlyMap<string, RuntimeOriginState>;
  readonly permissionsByOrigin: ReadonlyMap<
    string,
    ReadonlyArray<RuntimePermissionEntry>
  >;
  readonly pendingByOrigin: ReadonlyMap<
    string,
    ReadonlyArray<RuntimePendingRequest>
  >;
};

function sameOriginState(left: RuntimeOriginState, right: RuntimeOriginState) {
  return left.origin === right.origin && left.enabled === right.enabled;
}

function samePermissionEntry(
  left: RuntimePermissionEntry,
  right: RuntimePermissionEntry,
) {
  return (
    left.modelId === right.modelId &&
    left.modelName === right.modelName &&
    left.provider === right.provider &&
    left.status === right.status &&
    left.requestedAt === right.requestedAt &&
    sameArray(left.capabilities, right.capabilities, (l, r) => l === r)
  );
}

function samePendingRequest(
  left: RuntimePendingRequest,
  right: RuntimePendingRequest,
) {
  return (
    left.id === right.id &&
    left.origin === right.origin &&
    left.modelId === right.modelId &&
    left.modelName === right.modelName &&
    left.provider === right.provider &&
    left.requestedAt === right.requestedAt &&
    left.dismissed === right.dismissed &&
    left.status === right.status &&
    sameArray(left.capabilities, right.capabilities, (l, r) => l === r)
  );
}

function samePermissionsSnapshot(
  left: PermissionsSnapshot,
  right: PermissionsSnapshot,
) {
  return (
    sameMap(left.originStates, right.originStates, sameOriginState) &&
    sameMap(left.permissionsByOrigin, right.permissionsByOrigin, (l, r) =>
      sameArray(l, r, samePermissionEntry),
    ) &&
    sameMap(left.pendingByOrigin, right.pendingByOrigin, (l, r) =>
      sameArray(l, r, samePendingRequest),
    )
  );
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

function loadModelRows(modelIds: ReadonlyArray<string>) {
  if (modelIds.length === 0) {
    return Effect.succeed(
      new Map<
        string,
        Awaited<ReturnType<typeof runtimeDb.models.bulkGet>>[number]
      >(),
    );
  }

  return Effect.tryPromise({
    try: () => runtimeDb.models.bulkGet([...modelIds]),
    catch: (error) => error,
  }).pipe(
    Effect.map(
      (rows) =>
        new Map(
          rows
            .filter((row): row is NonNullable<typeof row> => row != null)
            .map((row) => [row.id, row] as const),
        ),
    ),
  );
}

function buildPermissionsMap() {
  return Effect.gen(function* () {
    const rows = yield* Effect.tryPromise({
      try: () => runtimeDb.permissions.toArray(),
      catch: (error) => error,
    });
    const modelRows = yield* loadModelRows(rows.map((row) => row.modelId));
    const grouped = new Map<string, Array<RuntimePermissionEntry>>();

    for (const row of rows) {
      const modelRow = modelRows.get(row.modelId);
      const parsedModel = parseProviderModel(row.modelId);
      const fallbackModelName = parsedModel.modelID || row.modelId;
      const fallbackProvider = parsedModel.providerID || "unknown";
      const entries = grouped.get(row.origin) ?? [];
      entries.push({
        modelId: row.modelId,
        modelName: modelRow?.info.name ?? fallbackModelName,
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
  });
}

function buildPendingMap() {
  return Effect.gen(function* () {
    const rows = yield* Effect.tryPromise({
      try: () =>
        runtimeDb.pendingRequests
          .where("status")
          .equals("pending")
          .filter((item) => !item.dismissed)
        .toArray(),
      catch: (error) => error,
    });
    const modelRows = yield* loadModelRows(rows.map((row) => row.modelId));
    const grouped = new Map<string, Array<RuntimePendingRequest>>();

    for (const row of rows) {
      const modelRow = modelRows.get(row.modelId);
      const parsedModel = parseProviderModel(row.modelId);
      const fallbackModelName = parsedModel.modelID || row.modelName;
      const fallbackProvider = parsedModel.providerID || row.provider;
      const entries = grouped.get(row.origin) ?? [];
      entries.push({
        id: row.id,
        origin: row.origin,
        modelId: row.modelId,
        modelName: modelRow?.info.name ?? fallbackModelName,
        provider: modelRow?.providerID ?? fallbackProvider,
        capabilities: modelRow?.capabilities ?? row.capabilities,
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
  });
}

export const PermissionsServiceLive = Layer.effect(
  PermissionsService,
  Effect.gen(function* () {
    const snapshotRef = yield* SubscriptionRef.make<PermissionsSnapshot>({
      originStates: new Map(),
      permissionsByOrigin: new Map(),
      pendingByOrigin: new Map(),
    });
    const waiters = new Map<string, Deferred.Deferred<void>>();

    const refreshSnapshots = Effect.gen(function* () {
      const [originRows, permissionsMap, pendingMap] = yield* Effect.all([
        Effect.tryPromise({
          try: () => runtimeDb.origins.toArray(),
          catch: (error) => error,
        }),
        buildPermissionsMap(),
        buildPendingMap(),
      ]);

      const nextSnapshot = {
        originStates: toOriginStateMap(originRows),
        permissionsByOrigin: permissionsMap,
        pendingByOrigin: pendingMap,
      } satisfies PermissionsSnapshot;

      yield* SubscriptionRef.modify(snapshotRef, (current) => [
        undefined,
        replaceIfChanged(current, nextSnapshot, samePermissionsSnapshot),
      ]);
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

    const awaitAbortSignal = (signal: AbortSignal) =>
      Effect.async<"aborted">((resume) => {
        const onAbort = () => {
          signal.removeEventListener("abort", onAbort);
          resume(Effect.succeed("aborted"));
        };

        signal.addEventListener("abort", onAbort, { once: true });

        if (signal.aborted) {
          onAbort();
        }

        return Effect.sync(() => {
          signal.removeEventListener("abort", onAbort);
        });
      });

    yield* refreshSnapshots;

    return {
      getOriginState: (origin: string) =>
        SubscriptionRef.get(snapshotRef).pipe(
          Effect.map(
            (snapshot) =>
              snapshot.originStates.get(origin) ?? {
                origin,
                enabled: true,
              },
          ),
        ),
      streamOriginState: (origin: string) =>
        snapshotRef.changes.pipe(
          Stream.map(
            (snapshot) =>
              snapshot.originStates.get(origin) ?? {
                origin,
                enabled: true,
              },
          ),
          Stream.changesWith(sameOriginState),
        ),
      listPermissions: (origin: string) =>
        SubscriptionRef.get(snapshotRef).pipe(
          Effect.map(
            (snapshot) => snapshot.permissionsByOrigin.get(origin) ?? [],
          ),
        ),
      streamPermissions: (origin: string) =>
        snapshotRef.changes.pipe(
          Stream.map(
            (snapshot) => snapshot.permissionsByOrigin.get(origin) ?? [],
          ),
          Stream.changesWith((left, right) =>
            sameArray(left, right, samePermissionEntry),
          ),
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
        SubscriptionRef.get(snapshotRef).pipe(
          Effect.map((snapshot) => snapshot.pendingByOrigin.get(origin) ?? []),
        ),
      streamPending: (origin: string) =>
        snapshotRef.changes.pipe(
          Stream.map((snapshot) => snapshot.pendingByOrigin.get(origin) ?? []),
          Stream.changesWith((left, right) =>
            sameArray(left, right, samePendingRequest),
          ),
        ),
      waitForPermissionDecision: (
        requestId: string,
        timeoutMs = PENDING_REQUEST_TIMEOUT_MS,
        signal?: AbortSignal,
      ) =>
        Effect.gen(function* () {
          const pending = yield* getPendingRequest(requestId).pipe(
            Effect.map((request) => request?.status === "pending"),
          );
          if (!pending) {
            return "resolved" as const;
          }

          const waiter = yield* getOrCreateWaiter(requestId);

          const contenders: Array<
            Effect.Effect<"resolved" | "timeout" | "aborted">
          > = [
            Deferred.await(waiter).pipe(Effect.as("resolved" as const)),
            Effect.sleep(timeoutMs).pipe(Effect.as("timeout" as const)),
          ];

          if (signal) {
            contenders.push(awaitAbortSignal(signal));
          }

          return yield* Effect.raceAll(contenders);
        }),
      streamOriginStates: () =>
        snapshotRef.changes.pipe(
          Stream.map((snapshot) => snapshot.originStates),
          Stream.changesWith((left, right) =>
            sameMap(left, right, sameOriginState),
          ),
        ),
      streamPermissionsMap: () =>
        snapshotRef.changes.pipe(
          Stream.map((snapshot) => snapshot.permissionsByOrigin),
          Stream.changesWith((left, right) =>
            sameMap(left, right, (l, r) => sameArray(l, r, samePermissionEntry)),
          ),
        ),
      streamPendingMap: () =>
        snapshotRef.changes.pipe(
          Stream.map((snapshot) => snapshot.pendingByOrigin),
          Stream.changesWith((left, right) =>
            sameMap(left, right, (l, r) => sameArray(l, r, samePendingRequest)),
          ),
        ),
    } satisfies PermissionsServiceApi;
  }),
);

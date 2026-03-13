import { browser } from "@wxt-dev/browser";
import {
  AuthFlowService,
  CatalogService,
  type AuthFlowServiceApi,
} from "@llm-bridge/runtime-core";
import {
  RuntimeInternalError,
  RuntimeValidationError,
  isRuntimeRpcError,
  type RuntimeAuthFlowInstruction,
  type RuntimeAuthFlowSnapshot,
} from "@llm-bridge/contracts";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import {
  disconnectProvider as disconnectProviderAuth,
  listProviderAuthMethods,
  startProviderAuth,
} from "@/background/runtime/auth/provider-auth";
import type { RuntimeAuthMethod } from "@/background/runtime/providers/adapters/types";

const AUTH_FLOW_WINDOW_WIDTH = 420;
const AUTH_FLOW_WINDOW_HEIGHT = 640;
const AUTH_FLOW_TTL_MS = 30 * 60_000;
const AUTH_FLOW_SWEEP_INTERVAL_MS = 60_000;

type RuntimeAuthFlowStatus =
  | "idle"
  | "authorizing"
  | "success"
  | "error"
  | "canceled";

type AuthFlowState = {
  providerID: string;
  status: RuntimeAuthFlowStatus;
  methods: ReadonlyArray<RuntimeAuthMethod>;
  runningMethodID?: string;
  instruction?: RuntimeAuthFlowInstruction;
  error?: string;
  updatedAt: number;
  expiresAt: number;
  windowId?: number;
  controller?: AbortController;
  task?: Promise<unknown>;
};

type AuthFlowStateSnapshot = {
  providerID: string;
  result: RuntimeAuthFlowSnapshot;
};

function isTerminalStatus(status: RuntimeAuthFlowStatus) {
  return status === "success" || status === "error" || status === "canceled";
}

function canCancel(status: RuntimeAuthFlowStatus) {
  return status === "authorizing";
}

function sameSnapshot<A>(left: A, right: A) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function toAuthFlowErrorSummary(error: unknown) {
  if (!isRuntimeRpcError(error)) {
    return "Authentication failed. Please retry.";
  }

  switch (error._tag) {
    case "RuntimeUpstreamServiceError":
      return `${error.providerID} authentication request failed${error.statusCode ? ` (${error.statusCode})` : ""}.`;
    case "RuntimeAuthProviderError":
    case "RuntimeValidationError":
    case "BridgeInitializationTimeoutError":
    case "RpcProtocolError":
    case "BridgeAbortError":
    case "BridgeMessagePortError":
    case "ProviderNotConnectedError":
    case "PermissionDeniedError":
    case "AuthFlowExpiredError":
    case "TransportProtocolError":
    case "ModelNotFoundError":
      return error.message;
    case "RuntimeAuthorizationError":
      return "Authentication request is not authorized.";
    case "RuntimeInternalError":
      return "Authentication failed due to an internal runtime error.";
    case "RuntimeDefectError":
      return "Authentication failed. Please retry.";
    default:
      return "Authentication failed. Please retry.";
  }
}

function snapshot(flow: AuthFlowState): RuntimeAuthFlowSnapshot {
  return {
    providerID: flow.providerID,
    status: flow.status,
    methods: [...flow.methods],
    runningMethodID: flow.runningMethodID,
    instruction: flow.instruction,
    error: flow.error,
    updatedAt: flow.updatedAt,
    canCancel: canCancel(flow.status),
  };
}

function toSnapshotState(
  providerID: string,
  methods: ReadonlyArray<RuntimeAuthMethod>,
): AuthFlowState {
  const updatedAt = Date.now();

  return {
    providerID,
    status: "idle",
    methods,
    updatedAt,
    expiresAt: updatedAt + AUTH_FLOW_TTL_MS,
  };
}

function fallbackIdleSnapshot(providerID: string): RuntimeAuthFlowSnapshot {
  return {
    providerID,
    status: "idle",
    methods: [],
    updatedAt: Date.now(),
    canCancel: false,
  };
}

export const AuthFlowServiceLive = Layer.scoped(
  AuthFlowService,
  Effect.gen(function* () {
    const catalog = yield* CatalogService;
    const snapshotsRef = yield* SubscriptionRef.make<
      ReadonlyMap<string, AuthFlowStateSnapshot>
    >(new Map());

    const flows = new Map<string, AuthFlowState>();
    const providerWindows = new Map<string, number>();
    const windowProviders = new Map<number, string>();

    const publishState = (flow: AuthFlowState) =>
      SubscriptionRef.modify(snapshotsRef, (current) => {
        const next = new Map(current);
        next.set(flow.providerID, {
          providerID: flow.providerID,
          result: snapshot(flow),
        });
        return [undefined, next] as const;
      });

    const publishSnapshot = (providerID: string, result: RuntimeAuthFlowSnapshot) =>
      SubscriptionRef.modify(snapshotsRef, (current) => {
        const next = new Map(current);
        next.set(providerID, {
          providerID,
          result,
        });
        return [undefined, next] as const;
      });

    const markUpdated = (flow: AuthFlowState) => {
      const updatedAt = Date.now();
      flow.updatedAt = updatedAt;
      flow.expiresAt = updatedAt + AUTH_FLOW_TTL_MS;
    };

    const setFlow = (flow: AuthFlowState) =>
      Effect.gen(function* () {
        markUpdated(flow);
        flows.set(flow.providerID, flow);
        yield* publishState(flow);
      });

    const clearExecution = (flow: AuthFlowState) => {
      flow.controller = undefined;
      flow.task = undefined;
      flow.runningMethodID = undefined;
    };

    const idleSnapshot = (providerID: string) =>
      Effect.gen(function* () {
        const methods = yield* listProviderAuthMethods(providerID);
        const state = toSnapshotState(providerID, methods);
        return snapshot(state);
      });

    const buildIdleFlow = (providerID: string) =>
      Effect.map(listProviderAuthMethods(providerID), (methods) =>
        toSnapshotState(providerID, methods),
      );

    const ensureFlow = (providerID: string) =>
      Effect.gen(function* () {
        const current = flows.get(providerID);
        if (current && !isTerminalStatus(current.status)) {
          return current;
        }

        const next = yield* buildIdleFlow(providerID);
        yield* setFlow(next);
        return next;
      });

    const cancelFlow = (input: { providerID: string; reason?: string }) =>
      Effect.gen(function* () {
        const flow = flows.get(input.providerID);
        if (!flow) {
          return yield* idleSnapshot(input.providerID);
        }

        if (isTerminalStatus(flow.status)) {
          return snapshot(flow);
        }

        flow.controller?.abort();
        flow.status = "canceled";
        flow.error =
          input.reason === "expired"
            ? "Authentication expired."
            : "Authentication canceled.";
        flow.instruction = undefined;
        clearExecution(flow);
        yield* setFlow(flow);
        return snapshot(flow);
      });

    const handleWindowClosed = (windowId: number) =>
      Effect.gen(function* () {
        const providerID = windowProviders.get(windowId);
        if (!providerID) {
          return;
        }

        windowProviders.delete(windowId);
        providerWindows.delete(providerID);

        const flow = flows.get(providerID);
        if (flow) {
          flow.windowId = undefined;
        }

        yield* cancelFlow({
          providerID,
          reason: "window_closed",
        });
      });

    const pruneExpiredFlows = Effect.gen(function* () {
      const now = Date.now();
      for (const [providerID, flow] of flows) {
        if (flow.expiresAt > now || isTerminalStatus(flow.status)) {
          continue;
        }

        yield* cancelFlow({
          providerID,
          reason: "expired",
        });
      }
    });

    const onWindowRemoved: Parameters<typeof browser.windows.onRemoved.addListener>[0] =
      (windowId) => {
        void Effect.runPromise(handleWindowClosed(windowId)).catch(() => undefined);
      };

    browser.windows?.onRemoved.addListener(onWindowRemoved);
    const sweepTimer = setInterval(() => {
      void Effect.runPromise(pruneExpiredFlows).catch(() => undefined);
    }, AUTH_FLOW_SWEEP_INTERVAL_MS);

    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        browser.windows?.onRemoved.removeListener(onWindowRemoved);
        clearInterval(sweepTimer);
      }),
    );

    return {
      openProviderAuthWindow: (providerID: string) =>
        Effect.gen(function* () {
          const flow = yield* ensureFlow(providerID);

          if (typeof flow.windowId === "number") {
            const existingWindowId = flow.windowId;
            const reuseExit = yield* Effect.exit(
              Effect.tryPromise({
                try: () =>
                  browser.windows.update(existingWindowId, {
                    focused: true,
                  }),
                catch: (error) => error,
              }),
            );

            if (Exit.isSuccess(reuseExit)) {
              const windowId = flow.windowId;
              if (typeof windowId !== "number") {
                return yield* new RuntimeInternalError({
                  operation: "openProviderAuthWindow",
                  message: "Auth window could not be reused",
                });
              }

              return {
                providerID,
                reused: true,
                windowId,
              };
            }

            providerWindows.delete(providerID);
            if (typeof flow.windowId === "number") {
              windowProviders.delete(flow.windowId);
            }
            flow.windowId = undefined;
          }

          const url = new URL(browser.runtime.getURL("/connect.html"));
          url.searchParams.set("providerID", providerID);

          const windowRef = yield* Effect.tryPromise({
            try: () =>
              browser.windows.create({
                url: url.toString(),
                type: "popup",
                focused: true,
                width: AUTH_FLOW_WINDOW_WIDTH,
                height: AUTH_FLOW_WINDOW_HEIGHT,
              }),
            catch: (error) =>
              new RuntimeInternalError({
                operation: "openProviderAuthWindow",
                message:
                  error instanceof Error
                    ? error.message
                    : "Failed to open provider auth window",
              }),
          });

          if (!windowRef || typeof windowRef.id !== "number") {
            return yield* new RuntimeInternalError({
              operation: "openProviderAuthWindow",
              message: "Failed to open provider auth window",
            });
          }

          flow.windowId = windowRef.id;
          providerWindows.set(providerID, windowRef.id);
          windowProviders.set(windowRef.id, providerID);
          yield* setFlow(flow);

          return {
            providerID,
            reused: false,
            windowId: windowRef.id,
          };
        }),
      getProviderAuthFlow: (providerID: string) =>
        Effect.gen(function* () {
          const flow = flows.get(providerID);
          if (!flow) {
            return {
              providerID,
              result: yield* idleSnapshot(providerID),
            };
          }

          if (flow.expiresAt <= Date.now() && !isTerminalStatus(flow.status)) {
            return {
              providerID,
              result: yield* cancelFlow({
                providerID,
                reason: "expired",
              }),
            };
          }

          return {
            providerID,
            result: snapshot(flow),
          };
        }),
      streamProviderAuthFlow: (providerID: string) =>
        Stream.unwrap(
          Effect.gen(function* () {
            const initial = yield* idleSnapshot(providerID).pipe(
              Effect.catchAll(() =>
                Effect.succeed(fallbackIdleSnapshot(providerID)),
              ),
              Effect.map((result) => ({
                providerID,
                result,
              })),
            );

            return Stream.concat(
              Stream.make(initial),
              snapshotsRef.changes.pipe(
                Stream.drop(1),
                Stream.filterMap((entries) =>
                  Option.fromNullable(entries.get(providerID)),
                ),
                Stream.changesWith((left, right) =>
                  sameSnapshot(left.result, right.result),
                ),
              ),
            );
          }),
        ),
      startProviderAuthFlow: (input) =>
        Effect.gen(function* () {
          const flow = yield* ensureFlow(input.providerID);

          if (flow.status === "authorizing") {
            return yield* new RuntimeValidationError({
              message: "Auth flow is already in progress",
            });
          }

          const methods = yield* listProviderAuthMethods(input.providerID);
          const selected = methods.find((method) => method.id === input.methodID);
          if (!selected) {
            return yield* new RuntimeValidationError({
              message: `Auth method ${input.methodID} is not available for provider ${input.providerID}`,
            });
          }

          clearExecution(flow);
          flow.methods = methods;
          flow.status = "authorizing";
          flow.error = undefined;
          flow.instruction = undefined;
          flow.runningMethodID = selected.id;
          flow.controller = new AbortController();
          yield* setFlow(flow);

          const task = Effect.runPromise(
            startProviderAuth({
              providerID: input.providerID,
              methodID: selected.id,
              values: input.values ?? {},
              signal: flow.controller.signal,
              onInstruction: (instruction) =>
                Effect.gen(function* () {
                  const latest = flows.get(input.providerID);
                  if (!latest || latest !== flow || latest.status !== "authorizing") {
                    return;
                  }

                  latest.instruction = instruction;
                  yield* setFlow(latest);
                }),
            }),
          );
          flow.task = task;

          const exit = yield* Effect.exit(
            Effect.tryPromise({
              try: () => task,
              catch: (error) => error,
            }),
          );

          const latest = flows.get(input.providerID);
          if (!latest) {
            return {
              providerID: input.providerID,
              result: yield* idleSnapshot(input.providerID),
            };
          }

          if (latest !== flow) {
            return {
              providerID: input.providerID,
              result: snapshot(latest),
            };
          }

          if (Exit.isSuccess(exit)) {
            yield* catalog.refreshCatalogForProvider(input.providerID);
            latest.status = "success";
            latest.error = undefined;
            latest.instruction = undefined;
            clearExecution(latest);
            latest.methods = yield* listProviderAuthMethods(input.providerID);
            yield* setFlow(latest);

            return {
              providerID: input.providerID,
              result: snapshot(latest),
            };
          }

          const failure = Cause.squash(exit.cause);
          if (latest.controller?.signal.aborted) {
            latest.status = "canceled";
            latest.error = "Authentication canceled.";
          } else {
            latest.status = "error";
            latest.error = toAuthFlowErrorSummary(failure);
            console.error("[auth-flow] provider auth failed", {
              providerID: input.providerID,
              methodID: selected.id,
              error: failure,
            });
          }

          latest.instruction = undefined;
          clearExecution(latest);
          latest.methods = yield* listProviderAuthMethods(input.providerID);
          yield* setFlow(latest);

          return {
            providerID: input.providerID,
            result: snapshot(latest),
          };
        }),
      cancelProviderAuthFlow: (input) =>
        Effect.map(
          cancelFlow(input),
          (result) =>
            ({
              providerID: input.providerID,
              result,
            }) as const,
        ),
      disconnectProvider: (providerID: string) =>
        Effect.gen(function* () {
          yield* cancelFlow({
            providerID,
            reason: "disconnect",
          });
          yield* disconnectProviderAuth(providerID);
          yield* catalog.refreshCatalogForProvider(providerID);

          const idle = yield* idleSnapshot(providerID);
          yield* publishSnapshot(providerID, idle);
          flows.set(providerID, {
            ...toSnapshotState(providerID, idle.methods),
            windowId: providerWindows.get(providerID),
          });

          return {
            providerID,
            connected: false,
          };
        }),
      handleWindowClosed: (windowId: number) =>
        handleWindowClosed(windowId).pipe(Effect.catchAll(() => Effect.void)),
    } satisfies AuthFlowServiceApi;
  }),
);

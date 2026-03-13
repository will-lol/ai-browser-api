import { browser } from "@wxt-dev/browser";
import {
  AuthFlowService,
  CatalogService,
  type AuthFlowServiceApi,
} from "@llm-bridge/runtime-core";
import {
  RuntimeInternalError,
  type RuntimeRpcError,
  RuntimeValidationError,
  RuntimeDefectError,
  isRuntimeRpcError,
  type RuntimeAuthFlowInstruction,
  type RuntimeAuthFlowSnapshot,
} from "@llm-bridge/contracts";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
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

type RuntimeAuthFlowStatus =
  | "idle"
  | "authorizing"
  | "success"
  | "error"
  | "canceled";

type AuthFlowFiber = Fiber.RuntimeFiber<
  Effect.Effect.Success<ReturnType<typeof startProviderAuth>>,
  Effect.Effect.Error<ReturnType<typeof startProviderAuth>>
>;

type AuthFlowState = {
  providerID: string;
  status: RuntimeAuthFlowStatus;
  methods: ReadonlyArray<RuntimeAuthMethod>;
  runningMethodID?: string;
  instruction?: RuntimeAuthFlowInstruction;
  error?: string;
  updatedAt: number;
  windowId?: number;
  controller?: AbortController;
  fiber?: AuthFlowFiber;
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

function sameInstruction(
  left: RuntimeAuthFlowInstruction | undefined,
  right: RuntimeAuthFlowInstruction | undefined,
) {
  if (left === right) return true;
  if (!left || !right) return false;

  return (
    left.kind === right.kind &&
    left.title === right.title &&
    left.message === right.message &&
    left.code === right.code &&
    left.url === right.url &&
    left.autoOpened === right.autoOpened
  );
}

function sameMethods(
  left: ReadonlyArray<RuntimeAuthMethod>,
  right: ReadonlyArray<RuntimeAuthMethod>,
) {
  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    const current = left[index];
    const next = right[index];

    if (
      current.id !== next.id ||
      current.type !== next.type ||
      current.label !== next.label ||
      current.fields.length !== next.fields.length
    ) {
      return false;
    }

    for (let fieldIndex = 0; fieldIndex < current.fields.length; fieldIndex += 1) {
      const currentField = current.fields[fieldIndex];
      const nextField = next.fields[fieldIndex];

      if (
        currentField.key !== nextField.key ||
        currentField.type !== nextField.type ||
        currentField.label !== nextField.label ||
        currentField.placeholder !== nextField.placeholder ||
        currentField.defaultValue !== nextField.defaultValue ||
        currentField.required !== nextField.required ||
        currentField.description !== nextField.description ||
        currentField.condition?.key !== nextField.condition?.key ||
        currentField.condition?.equals !== nextField.condition?.equals
      ) {
        return false;
      }

      if (currentField.type !== "select") {
        continue;
      }

      if (nextField.type !== "select") {
        return false;
      }

      if (currentField.options.length !== nextField.options.length) {
        return false;
      }

      for (
        let optionIndex = 0;
        optionIndex < currentField.options.length;
        optionIndex += 1
      ) {
        const currentOption = currentField.options[optionIndex];
        const nextOption = nextField.options[optionIndex];

        if (
          currentOption.label !== nextOption.label ||
          currentOption.value !== nextOption.value ||
          currentOption.hint !== nextOption.hint
        ) {
          return false;
        }
      }
    }
  }

  return true;
}

function sameSnapshotPayload(
  left: RuntimeAuthFlowSnapshot,
  right: RuntimeAuthFlowSnapshot,
) {
  return (
    left.providerID === right.providerID &&
    left.status === right.status &&
    left.runningMethodID === right.runningMethodID &&
    left.error === right.error &&
    left.canCancel === right.canCancel &&
    sameInstruction(left.instruction, right.instruction) &&
    sameMethods(left.methods, right.methods)
  );
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
  options: {
    windowId?: number;
  } = {},
): AuthFlowState {
  return {
    providerID,
    status: "idle",
    methods,
    updatedAt: Date.now(),
    windowId: options.windowId,
  };
}

export const AuthFlowServiceLive = Layer.scoped(
  AuthFlowService,
  Effect.gen(function* () {
    const catalog = yield* CatalogService;
    const serviceScope = yield* Effect.scope;
    const snapshotsRef = yield* SubscriptionRef.make<
      ReadonlyMap<string, AuthFlowStateSnapshot>
    >(new Map());

    const flows = new Map<string, AuthFlowState>();
    const windowProviders = new Map<number, string>();

    const setFlow = (flow: AuthFlowState) =>
      SubscriptionRef.modify(snapshotsRef, (current) => {
        flows.set(flow.providerID, flow);

        const previous = current.get(flow.providerID)?.result;
        flow.updatedAt = Date.now();
        const result = snapshot(flow);

        if (previous && sameSnapshotPayload(previous, result)) {
          flow.updatedAt = previous.updatedAt;
          return [undefined, current] as const;
        }

        const next = new Map(current);
        next.set(flow.providerID, {
          providerID: flow.providerID,
          result,
        });
        return [undefined, next] as const;
      });

    const clearExecution = (flow: AuthFlowState) => {
      flow.controller = undefined;
      flow.fiber = undefined;
      flow.runningMethodID = undefined;
    };

    const clearWindowReference = (flow: AuthFlowState) => {
      if (typeof flow.windowId !== "number") {
        return;
      }

      windowProviders.delete(flow.windowId);
      flow.windowId = undefined;
    };

    const setWindowReference = (flow: AuthFlowState, windowId: number) => {
      if (typeof flow.windowId === "number" && flow.windowId !== windowId) {
        windowProviders.delete(flow.windowId);
      }

      flow.windowId = windowId;
      windowProviders.set(windowId, flow.providerID);
    };

    const buildIdleFlow = (
      providerID: string,
      options: {
        windowId?: number;
      } = {},
    ): Effect.Effect<AuthFlowState, RuntimeRpcError> =>
      listProviderAuthMethods(providerID).pipe(
        Effect.map((methods) => toSnapshotState(providerID, methods, options)),
        Effect.mapError((error) =>
          isRuntimeRpcError(error)
            ? error
            : new RuntimeInternalError({
                operation: "streamProviderAuthFlow",
                message:
                  error instanceof Error
                    ? error.message
                    : "Failed to load provider auth methods",
              }),
        ),
        Effect.catchAllDefect((defect) =>
          Effect.fail(
            new RuntimeDefectError({
              defect: String(defect),
            }),
          ),
        ),
      );

    const resolveProviderAuthFlow = (
      providerID: string,
    ): Effect.Effect<AuthFlowStateSnapshot, RuntimeRpcError> =>
      Effect.gen(function* () {
        const current = flows.get(providerID);
        if (current) {
          return {
            providerID,
            result: snapshot(current),
          };
        }

        const next = yield* buildIdleFlow(providerID);
        return {
          providerID,
          result: snapshot(next),
        };
      });

    const ensureFlow = (
      providerID: string,
    ): Effect.Effect<AuthFlowState, RuntimeRpcError> =>
      Effect.gen(function* () {
        const current = flows.get(providerID);
        if (current && !isTerminalStatus(current.status)) {
          return current;
        }

        const next = yield* buildIdleFlow(providerID, {
          windowId: current?.windowId,
        });
        yield* setFlow(next);
        return next;
      });

    const interruptExecution = (flow: AuthFlowState) =>
      Effect.gen(function* () {
        const fiber = flow.fiber;
        flow.controller?.abort();
        clearExecution(flow);

        if (fiber) {
          yield* Fiber.interrupt(fiber).pipe(Effect.asVoid);
        }
      });

    const cancelFlow = (input: { providerID: string; reason?: string }) =>
      Effect.gen(function* () {
        const flow = flows.get(input.providerID);
        if (!flow) {
          return (yield* resolveProviderAuthFlow(input.providerID)).result;
        }

        if (!canCancel(flow.status)) {
          return snapshot(flow);
        }

        if (input.reason === "window_closed") {
          clearWindowReference(flow);
        }

        flow.status = "canceled";
        flow.error = "Authentication canceled.";
        flow.instruction = undefined;
        yield* interruptExecution(flow);
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

        const flow = flows.get(providerID);
        if (!flow || flow.windowId !== windowId) {
          return;
        }

        flow.windowId = undefined;
        if (!canCancel(flow.status)) {
          return;
        }

        yield* cancelFlow({
          providerID,
          reason: "window_closed",
        });
      });

    const onWindowRemoved: Parameters<typeof browser.windows.onRemoved.addListener>[0] =
      (windowId) => {
        Effect.runFork(handleWindowClosed(windowId).pipe(Effect.catchAll(() => Effect.void)));
      };

    browser.windows?.onRemoved.addListener(onWindowRemoved);

    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        browser.windows?.onRemoved.removeListener(onWindowRemoved);
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

            clearWindowReference(flow);
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

          setWindowReference(flow, windowRef.id);

          return {
            providerID,
            reused: false,
            windowId: windowRef.id,
          };
        }),
      getProviderAuthFlow: (providerID: string) => resolveProviderAuthFlow(providerID),
      streamProviderAuthFlow: (
        providerID: string,
      ): Stream.Stream<AuthFlowStateSnapshot, RuntimeRpcError> =>
        Stream.unwrap(
          Effect.gen(function* () {
            const initial = yield* resolveProviderAuthFlow(providerID);

            return Stream.concat(
              Stream.make(initial),
              snapshotsRef.changes.pipe(
                Stream.drop(1),
                Stream.filterMap((entries) =>
                  Option.fromNullable(entries.get(providerID)),
                ),
              ),
            );
          }),
        ),
      startProviderAuthFlow: (input) =>
        Effect.gen(function* () {
          const current = flows.get(input.providerID);
          const flow =
            current && !isTerminalStatus(current.status)
              ? current
              : yield* buildIdleFlow(input.providerID, {
                  windowId: current?.windowId,
                });

          if (flow !== current) {
            flows.set(input.providerID, flow);
          }

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

          const fiber = yield* Effect.forkIn(
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
            serviceScope,
          );
          flow.fiber = fiber;

          const exit = yield* Fiber.await(fiber);

          const latest = flows.get(input.providerID);
          if (!latest) {
            return yield* resolveProviderAuthFlow(input.providerID);
          }

          if (latest !== flow || latest.status !== "authorizing") {
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

          const canceled =
            latest.controller?.signal.aborted === true ||
            Cause.isInterruptedOnly(exit.cause);

          if (canceled) {
            latest.status = "canceled";
            latest.error = "Authentication canceled.";
          } else {
            const failure = Cause.squash(exit.cause);
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
          const current = flows.get(providerID);
          if (current) {
            current.instruction = undefined;
            current.error = undefined;
            yield* interruptExecution(current);
          }

          yield* disconnectProviderAuth(providerID);
          yield* catalog.refreshCatalogForProvider(providerID);

          const next = yield* buildIdleFlow(providerID, {
            windowId: current?.windowId,
          });
          yield* setFlow(next);

          return {
            providerID,
            connected: false,
          };
        }),
    } satisfies AuthFlowServiceApi;
  }),
);

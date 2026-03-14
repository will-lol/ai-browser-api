import { browser } from "@wxt-dev/browser";
import type * as Rpc from "@effect/rpc/Rpc";
import type * as RpcGroup from "@effect/rpc/RpcGroup";
import * as RpcServer from "@effect/rpc/RpcServer";
import type {
  FromClientEncoded,
  FromServerEncoded,
} from "@effect/rpc/RpcMessage";
import * as Effect from "effect/Effect";
import * as Scope from "effect/Scope";
import * as Exit from "effect/Exit";
import * as Mailbox from "effect/Mailbox";
import * as Option from "effect/Option";
import * as Layer from "effect/Layer";
import {
  RuntimeAdminRpcGroup,
  RUNTIME_ADMIN_RPC_PORT_NAME,
  RuntimeAdminRpc,
  RUNTIME_PUBLIC_RPC_PORT_NAME,
  RuntimeAdminAllowedTags,
  RuntimeAuthorizationError,
  RuntimePublicRpcGroup,
  RuntimePublicRpc,
  RuntimePublicAllowedTags,
  RuntimeValidationError,
  type RuntimeRpcError,
} from "@llm-bridge/contracts";
import {
  offerMailboxFromCallback,
  runDetachedTransportServerEffect,
} from "@/shared/rpc/transport-server-boundary";

type RuntimePort = ReturnType<typeof browser.runtime.connect>;
type RuntimeSender = RuntimePort["sender"];
type RuntimeRole = "public" | "admin";

type RuntimeAuthorizedContext = {
  readonly role: RuntimeRole;
  readonly sender: RuntimeSender;
  readonly senderOrigin?: string;
};

type RpcAccessPolicy = {
  readonly authorizeConnect: (input: {
    role: RuntimeRole;
    port: RuntimePort;
  }) => Effect.Effect<RuntimeAuthorizedContext, RuntimeRpcError>;
  readonly authorizeRequest: (input: {
    allowedTags: ReadonlySet<string>;
    context: RuntimeAuthorizedContext;
    message: FromClientEncoded;
  }) => Effect.Effect<void, RuntimeRpcError>;
};

type RuntimePortSession = {
  readonly role: RuntimeRole;
  readonly authorizedContext: RuntimeAuthorizedContext;
  readonly port: RuntimePort;
  readonly onMessage: Parameters<RuntimePort["onMessage"]["addListener"]>[0];
  readonly onDisconnect: Parameters<
    RuntimePort["onDisconnect"]["addListener"]
  >[0];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseOrigin(url: string) {
  return Effect.try({
    try: () => new URL(url).origin,
    catch: () =>
      new RuntimeValidationError({
        message: "Caller URL is invalid",
      }),
  });
}

function toRuntimeAuthorizationError(operation: string, message: string) {
  return new RuntimeAuthorizationError({
    operation,
    message,
  });
}

function getPayloadOrigin(message: FromClientEncoded) {
  if (message._tag !== "Request") return undefined;
  if (!isRecord(message.payload)) return undefined;
  const origin = message.payload.origin;
  return typeof origin === "string" ? origin : undefined;
}

function canAccessRuntimeRpcTag(tag: string, allowedTags: ReadonlySet<string>) {
  return allowedTags.has(tag);
}

export function authorizeRuntimeRpcConnect(input: {
  role: RuntimeRole;
  sender: RuntimeSender | null | undefined;
  extensionID: string;
  extensionURL: string;
}) {
  return Effect.gen(function* () {
    const sender = input.sender;
    if (!sender || sender.id !== input.extensionID) {
      return yield* Effect.fail(
        toRuntimeAuthorizationError(
          "connect",
          "Caller is not part of this extension",
        ),
      );
    }

    const senderUrl = typeof sender.url === "string" ? sender.url : "";
    if (!senderUrl) {
      return yield* Effect.fail(
        toRuntimeAuthorizationError("connect", "Caller URL is unavailable"),
      );
    }

    const senderOrigin = yield* parseOrigin(senderUrl);
    const extensionOrigin = yield* parseOrigin(input.extensionURL);

    if (input.role === "public") {
      if (!sender.tab || typeof sender.tab.id !== "number") {
        return yield* Effect.fail(
          toRuntimeAuthorizationError(
            "connect",
            "Public RPC requires a tab-scoped sender",
          ),
        );
      }

      if (senderOrigin === extensionOrigin) {
        return yield* Effect.fail(
          toRuntimeAuthorizationError(
            "connect",
            "Public RPC rejects extension-origin callers",
          ),
        );
      }

      return {
        role: input.role,
        sender,
        senderOrigin,
      } as const;
    }

    if (senderOrigin !== extensionOrigin) {
      return yield* Effect.fail(
        toRuntimeAuthorizationError("connect", "Admin RPC is extension-only"),
      );
    }

    return {
      role: input.role,
      sender,
      senderOrigin,
    } as const;
  });
}

export function authorizeRuntimeRpcRequest(input: {
  allowedTags: ReadonlySet<string>;
  context: RuntimeAuthorizedContext;
  message: FromClientEncoded;
}) {
  return Effect.gen(function* () {
    if (input.message._tag !== "Request") {
      return;
    }

    if (!canAccessRuntimeRpcTag(input.message.tag, input.allowedTags)) {
      return yield* Effect.fail(
        toRuntimeAuthorizationError(
          input.message.tag,
          "RPC method is not available for this caller",
        ),
      );
    }

    if (input.context.role !== "public") {
      return;
    }

    const origin = getPayloadOrigin(input.message);
    if (!origin || origin !== input.context.senderOrigin) {
      return yield* Effect.fail(
        toRuntimeAuthorizationError(
          input.message.tag,
          "RPC origin does not match caller sender origin",
        ),
      );
    }
  });
}

const RuntimeRpcAccessPolicy: RpcAccessPolicy = {
  authorizeConnect: ({ role, port }) =>
    authorizeRuntimeRpcConnect({
      role,
      sender: port.sender,
      extensionID: browser.runtime.id,
      extensionURL: browser.runtime.getURL("/"),
    }),
  authorizeRequest: authorizeRuntimeRpcRequest,
};

type RuntimeServerOptions<Rpcs extends Rpc.Any> = {
  readonly role: RuntimeRole;
  readonly portName: string;
  readonly policy: RpcAccessPolicy;
  readonly rpcGroup: RpcGroup.RpcGroup<Rpcs>;
  readonly allowedTags: ReadonlySet<string>;
};

function protocolForRole<Rpcs extends Rpc.Any>(
  options: RuntimeServerOptions<Rpcs>,
) {
  return RpcServer.Protocol.make((writeRequest) =>
    Effect.gen(function* () {
      const allowedTags = options.allowedTags;
      const disconnects = yield* Mailbox.make<number>();
      let nextClientId = 0;
      const sessions = new Map<number, RuntimePortSession>();
      const connectedClientIds = new Set<number>();

      const cleanupSession = (clientId: number, _reason: string) => {
        const session = sessions.get(clientId);
        if (!session) return;

        session.port.onMessage.removeListener(session.onMessage);
        session.port.onDisconnect.removeListener(session.onDisconnect);
        sessions.delete(clientId);
        connectedClientIds.delete(clientId);
      };

      const rejectAndDisconnect = (clientId: number, reason: string) => {
        const session = sessions.get(clientId);

        cleanupSession(clientId, reason);

        if (session) {
          try {
            session.port.disconnect();
          } catch {
            // ignored
          }
        }

        offerMailboxFromCallback(disconnects, clientId, {
          onError: () => undefined,
        });
      };

      const onConnect: Parameters<
        typeof browser.runtime.onConnect.addListener
      >[0] = (port) => {
        if (port.name !== options.portName) return;

        let authorizedContext: RuntimeAuthorizedContext;
        try {
          authorizedContext = Effect.runSync(
            options.policy.authorizeConnect({
              role: options.role,
              port,
            }),
          );
        } catch {
          try {
            port.disconnect();
          } catch {
            // ignored
          }
          return;
        }

        const clientId = ++nextClientId;

        const onMessage: Parameters<typeof port.onMessage.addListener>[0] = (
          payload: FromClientEncoded,
        ) => {
          runDetachedTransportServerEffect(
            options.policy
              .authorizeRequest({
                allowedTags,
                context: authorizedContext,
                message: payload,
              })
              .pipe(
                Effect.flatMap(() => writeRequest(clientId, payload)),
                Effect.catchAll((_error) =>
                  Effect.sync(() => {
                    rejectAndDisconnect(clientId, "authorization-failed");
                  }),
                ),
              ),
            {
              onError: () => undefined,
            },
          );
        };

        const onDisconnect: Parameters<
          typeof port.onDisconnect.addListener
        >[0] = () => {
          cleanupSession(clientId, "port-disconnect");
          offerMailboxFromCallback(disconnects, clientId, {
            onError: () => undefined,
          });
        };

        sessions.set(clientId, {
          role: options.role,
          authorizedContext,
          port,
          onMessage,
          onDisconnect,
        });
        connectedClientIds.add(clientId);

        port.onMessage.addListener(onMessage);
        port.onDisconnect.addListener(onDisconnect);
      };

      browser.runtime.onConnect.addListener(onConnect);

      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          browser.runtime.onConnect.removeListener(onConnect);
          for (const [clientId, session] of sessions) {
            session.port.onMessage.removeListener(session.onMessage);
            session.port.onDisconnect.removeListener(session.onDisconnect);
            try {
              session.port.disconnect();
            } catch {
              // ignored
            }
            sessions.delete(clientId);
            connectedClientIds.delete(clientId);
          }
        }),
      );

      return {
        disconnects,
        send: (clientId: number, response: FromServerEncoded) =>
          Effect.sync(() => {
            const session = sessions.get(clientId);
            if (!session) return;

            try {
              session.port.postMessage(response);
            } catch {
              // ignored
            }
          }),
        end: (clientId: number) =>
          Effect.sync(() => {
            const session = sessions.get(clientId);
            if (!session) return;

            cleanupSession(clientId, "server-end");
            try {
              session.port.disconnect();
            } catch {
              // ignored
            }
          }),
        clientIds: Effect.sync(() => new Set(connectedClientIds)),
        initialMessage: Effect.succeed(Option.none()),
        supportsAck: true,
        supportsTransferables: false,
        supportsSpanPropagation: true,
      } as const;
    }),
  );
}

export function registerRuntimeRpcServer<PE, AE>(input: {
  publicLayer: Layer.Layer<
    Rpc.ToHandler<RuntimePublicRpc> | Rpc.Middleware<RuntimePublicRpc>,
    PE,
    never
  >;
  adminLayer: Layer.Layer<
    Rpc.ToHandler<RuntimeAdminRpc> | Rpc.Middleware<RuntimeAdminRpc>,
    AE,
    never
  >;
}) {
  return Effect.gen(function* () {
    const scope = yield* Scope.make();
    const policy = RuntimeRpcAccessPolicy;

    const publicProtocol = yield* protocolForRole({
      role: "public",
      portName: RUNTIME_PUBLIC_RPC_PORT_NAME,
      policy,
      rpcGroup: RuntimePublicRpcGroup,
      allowedTags: RuntimePublicAllowedTags,
    }).pipe(Scope.extend(scope));

    const adminProtocol = yield* protocolForRole({
      role: "admin",
      portName: RUNTIME_ADMIN_RPC_PORT_NAME,
      policy,
      rpcGroup: RuntimeAdminRpcGroup,
      allowedTags: RuntimeAdminAllowedTags,
    }).pipe(Scope.extend(scope));

    yield* Layer.buildWithScope(
      RpcServer.layer(RuntimePublicRpcGroup, {
        disableTracing: true,
      }).pipe(
        Layer.provide(input.publicLayer),
        Layer.provide(Layer.succeed(RpcServer.Protocol, publicProtocol)),
      ),
      scope,
    );

    yield* Layer.buildWithScope(
      RpcServer.layer(RuntimeAdminRpcGroup, {
        disableTracing: true,
      }).pipe(
        Layer.provide(input.adminLayer),
        Layer.provide(Layer.succeed(RpcServer.Protocol, adminProtocol)),
      ),
      scope,
    );

    return Scope.close(scope, Exit.void);
  });
}

export function makeRuntimeRpcServerLayer<PE, AE>(input: {
  publicLayer: Layer.Layer<
    Rpc.ToHandler<RuntimePublicRpc> | Rpc.Middleware<RuntimePublicRpc>,
    PE,
    never
  >;
  adminLayer: Layer.Layer<
    Rpc.ToHandler<RuntimeAdminRpc> | Rpc.Middleware<RuntimeAdminRpc>,
    AE,
    never
  >;
}) {
  return Layer.scopedDiscard(
    Effect.acquireRelease(registerRuntimeRpcServer(input), (dispose) =>
      dispose.pipe(Effect.catchAll(() => Effect.void)),
    ),
  );
}

import { browser } from "@wxt-dev/browser"
import type * as Rpc from "@effect/rpc/Rpc"
import * as RpcServer from "@effect/rpc/RpcServer"
import type { FromClientEncoded, FromServerEncoded } from "@effect/rpc/RpcMessage"
import type * as Layer from "effect/Layer"
import * as Effect from "effect/Effect"
import * as Scope from "effect/Scope"
import * as Exit from "effect/Exit"
import * as Mailbox from "effect/Mailbox"
import * as Option from "effect/Option"
import {
  RUNTIME_ADMIN_RPC_PORT_NAME,
  RUNTIME_PUBLIC_RPC_PORT_NAME,
  RuntimeAdminRpcGroup,
  RuntimeAuthorizationError,
  RuntimePublicRpcGroup,
  RuntimeValidationError,
  type RuntimeAdminRpc,
  type RuntimePublicRpc,
  type RuntimeRpcError,
} from "@llm-bridge/contracts"

type RuntimePort = ReturnType<typeof browser.runtime.connect>
type RuntimeSender = RuntimePort["sender"]
type RuntimeRole = "public" | "admin"
const RUNTIME_RPC_SERVER_LOG_PREFIX = "[runtime-rpc-background]"

type AuthorizedContext = {
  readonly role: RuntimeRole
  readonly sender: RuntimeSender
  readonly senderOrigin?: string
}

type RpcAccessPolicy = {
  readonly authorizeConnect: (input: {
    role: RuntimeRole
    port: RuntimePort
  }) => Effect.Effect<AuthorizedContext, RuntimeRpcError>
  readonly authorizeRequest: (input: {
    context: AuthorizedContext
    message: FromClientEncoded
  }) => Effect.Effect<void, RuntimeRpcError>
}

type RuntimePortSession = {
  readonly role: RuntimeRole
  readonly authorizedContext: AuthorizedContext
  readonly port: RuntimePort
  readonly onMessage: Parameters<RuntimePort["onMessage"]["addListener"]>[0]
  readonly onDisconnect: Parameters<RuntimePort["onDisconnect"]["addListener"]>[0]
}

const PublicRpcTags = new Set([
  "listModels",
  "getOriginState",
  "listPending",
  "requestPermission",
  "acquireModel",
  "modelDoGenerate",
  "modelDoStream",
  "abortModelCall",
])

const AdminRpcTags = new Set([
  "listProviders",
  "listModels",
  "listConnectedModels",
  "getOriginState",
  "listPermissions",
  "listPending",
  "openProviderAuthWindow",
  "getProviderAuthFlow",
  "startProviderAuthFlow",
  "cancelProviderAuthFlow",
  "disconnectProvider",
  "updatePermission",
  "requestPermission",
  "acquireModel",
  "modelDoGenerate",
  "modelDoStream",
  "abortModelCall",
])

function toLogString(meta: unknown) {
  if (meta === undefined) return ""
  if (typeof meta === "string") return meta

  try {
    return JSON.stringify(meta, (_key, value) => (typeof value === "bigint" ? value.toString() : value))
  } catch {
    return String(meta)
  }
}

function runtimeServerLog(event: string, meta?: unknown) {
  console.info(RUNTIME_RPC_SERVER_LOG_PREFIX, new Date().toISOString(), event, toLogString(meta))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function summarizeRpcMessage(message: unknown) {
  if (!isRecord(message)) {
    return { type: typeof message }
  }

  const summary: Record<string, unknown> = {}
  for (const key of ["_id", "_tag", "id", "requestId", "tag", "method", "clientId"]) {
    if (key in message) {
      summary[key] = message[key]
    }
  }

  if ("payload" in message && isRecord(message.payload)) {
    summary.payloadKeys = Object.keys(message.payload)
  }

  if ("values" in message && Array.isArray(message.values)) {
    summary.valuesLength = message.values.length
  }

  if ("exit" in message && isRecord(message.exit) && "_tag" in message.exit) {
    summary.exitTag = message.exit._tag
  }

  return summary
}

function parseOrigin(url: string) {
  return Effect.try({
    try: () => new URL(url).origin,
    catch: () =>
      new RuntimeValidationError({
        message: "Caller URL is invalid",
      }),
  })
}

function toRuntimeAuthorizationError(operation: string, message: string) {
  return new RuntimeAuthorizationError({
    operation,
    message,
  })
}

function getPayloadOrigin(message: FromClientEncoded) {
  if (message._tag !== "Request") return undefined
  if (!isRecord(message.payload)) return undefined
  const origin = message.payload.origin
  return typeof origin === "string" ? origin : undefined
}

function requestTag(message: FromClientEncoded) {
  return message._tag === "Request" ? message.tag : undefined
}

const RuntimeRpcAccessPolicy: RpcAccessPolicy = {
  authorizeConnect: ({ role, port }) =>
    Effect.gen(function*() {
      const sender = port.sender
      if (!sender || sender.id !== browser.runtime.id) {
        return yield* Effect.fail(
          toRuntimeAuthorizationError("connect", "Caller is not part of this extension"),
        )
      }

      const senderUrl = typeof sender.url === "string" ? sender.url : ""
      if (!senderUrl) {
        return yield* Effect.fail(
          toRuntimeAuthorizationError("connect", "Caller URL is unavailable"),
        )
      }

      const senderOrigin = yield* parseOrigin(senderUrl)
      const extensionOrigin = yield* parseOrigin(browser.runtime.getURL("/"))

      if (role === "public") {
        if (!sender.tab || typeof sender.tab.id !== "number") {
          return yield* Effect.fail(
            toRuntimeAuthorizationError("connect", "Public RPC requires a tab-scoped sender"),
          )
        }

        if (senderOrigin === extensionOrigin) {
          return yield* Effect.fail(
            toRuntimeAuthorizationError("connect", "Public RPC rejects extension-origin callers"),
          )
        }

        return {
          role,
          sender,
          senderOrigin,
        } as const
      }

      if (senderOrigin !== extensionOrigin) {
        return yield* Effect.fail(
          toRuntimeAuthorizationError("connect", "Admin RPC is extension-only"),
        )
      }

      return {
        role,
        sender,
        senderOrigin,
      } as const
    }),
  authorizeRequest: ({ context, message }) =>
    Effect.gen(function*() {
      if (message._tag !== "Request") {
        return
      }

      const allowed = context.role === "public" ? PublicRpcTags : AdminRpcTags
      if (!allowed.has(message.tag)) {
        return yield* Effect.fail(
          toRuntimeAuthorizationError(message.tag, "RPC method is not available for this caller"),
        )
      }

      if (context.role !== "public") {
        return
      }

      const origin = getPayloadOrigin(message)
      if (!origin || origin !== context.senderOrigin) {
        return yield* Effect.fail(
          toRuntimeAuthorizationError(message.tag, "RPC origin does not match caller sender origin"),
        )
      }

      if (message.tag === "requestPermission" && isRecord(message.payload)) {
        if (message.payload.action !== "create") {
          return yield* Effect.fail(
            toRuntimeAuthorizationError(message.tag, "Public caller can only create permission requests"),
          )
        }
      }
    }),
}

type RuntimeServerOptions = {
  readonly role: RuntimeRole
  readonly portName: string
  readonly policy: RpcAccessPolicy
}

function protocolForRole(
  options: RuntimeServerOptions,
) {
  return RpcServer.Protocol.make((writeRequest) =>
    Effect.gen(function*() {
      const disconnects = yield* Mailbox.make<number>()
      let nextClientId = 0
      const sessions = new Map<number, RuntimePortSession>()
      const connectedClientIds = new Set<number>()

      const cleanupSession = (clientId: number, reason: string) => {
        const session = sessions.get(clientId)
        if (!session) return

        runtimeServerLog("transport.session.cleanup", {
          role: options.role,
          clientId,
          reason,
          senderOrigin: session.authorizedContext.senderOrigin,
        })

        session.port.onMessage.removeListener(session.onMessage)
        session.port.onDisconnect.removeListener(session.onDisconnect)
        sessions.delete(clientId)
        connectedClientIds.delete(clientId)
      }

      const rejectAndDisconnect = (clientId: number, reason: string, error: RuntimeRpcError) => {
        const session = sessions.get(clientId)
        runtimeServerLog("transport.request.rejected", {
          role: options.role,
          clientId,
          reason,
          errorTag: isRecord(error) && "_tag" in error ? error._tag : undefined,
          message: isRecord(error) && "message" in error ? error.message : undefined,
        })

        cleanupSession(clientId, reason)

        if (session) {
          try {
            session.port.disconnect()
          } catch {
            // ignored
          }
        }

        void Effect.runPromise(disconnects.offer(clientId)).catch(() => undefined)
      }

      const onConnect: Parameters<typeof browser.runtime.onConnect.addListener>[0] = (port) => {
        if (port.name !== options.portName) return

        let authorizedContext: AuthorizedContext
        try {
          authorizedContext = Effect.runSync(options.policy.authorizeConnect({
            role: options.role,
            port,
          }))
        } catch {
          runtimeServerLog("transport.connect.rejected", {
            role: options.role,
            portName: port.name,
            senderUrl: port.sender?.url,
          })
          try {
            port.disconnect()
          } catch {
            // ignored
          }
          return
        }

        const clientId = ++nextClientId

        const onMessage: Parameters<typeof port.onMessage.addListener>[0] = (payload: FromClientEncoded) => {
          runtimeServerLog("transport.inbound", {
            role: options.role,
            clientId,
            message: summarizeRpcMessage(payload),
          })

          void Effect.runPromise(
            options.policy.authorizeRequest({
              context: authorizedContext,
              message: payload,
            }).pipe(
              Effect.flatMap(() => writeRequest(clientId, payload)),
              Effect.catchAll((error) =>
                Effect.sync(() => {
                  rejectAndDisconnect(clientId, "authorization-failed", error)
                })),
            ),
          ).catch((error) => {
            runtimeServerLog("transport.write.failed", {
              role: options.role,
              clientId,
              tag: requestTag(payload),
              message: error instanceof Error ? error.message : String(error),
            })
          })
        }

        const onDisconnect: Parameters<typeof port.onDisconnect.addListener>[0] = () => {
          runtimeServerLog("transport.disconnected", {
            role: options.role,
            clientId,
            lastError: browser.runtime.lastError?.message,
          })
          cleanupSession(clientId, "port-disconnect")
          void Effect.runPromise(disconnects.offer(clientId)).catch(() => undefined)
        }

        sessions.set(clientId, {
          role: options.role,
          authorizedContext,
          port,
          onMessage,
          onDisconnect,
        })
        connectedClientIds.add(clientId)

        runtimeServerLog("transport.connected", {
          role: options.role,
          clientId,
          portName: port.name,
          senderOrigin: authorizedContext.senderOrigin,
          hasTab: Boolean(port.sender?.tab),
        })

        port.onMessage.addListener(onMessage)
        port.onDisconnect.addListener(onDisconnect)
      }

      browser.runtime.onConnect.addListener(onConnect)

      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          browser.runtime.onConnect.removeListener(onConnect)
          for (const [clientId, session] of sessions) {
            session.port.onMessage.removeListener(session.onMessage)
            session.port.onDisconnect.removeListener(session.onDisconnect)
            try {
              session.port.disconnect()
            } catch {
              // ignored
            }
            sessions.delete(clientId)
            connectedClientIds.delete(clientId)
          }
        }),
      )

      return {
        disconnects,
        send: (clientId: number, response: FromServerEncoded) =>
          Effect.sync(() => {
            const session = sessions.get(clientId)
            if (!session) return

            runtimeServerLog("transport.outbound", {
              role: options.role,
              clientId,
              message: summarizeRpcMessage(response),
            })

            try {
              session.port.postMessage(response)
            } catch (error) {
              runtimeServerLog("transport.outbound.postMessageFailed", {
                role: options.role,
                clientId,
                message: error instanceof Error ? error.message : String(error),
              })
            }
          }),
        end: (clientId: number) =>
          Effect.sync(() => {
            const session = sessions.get(clientId)
            if (!session) return

            cleanupSession(clientId, "server-end")
            try {
              session.port.disconnect()
            } catch {
              // ignored
            }
          }),
        clientIds: Effect.sync(() => new Set(connectedClientIds)),
        initialMessage: Effect.succeed(Option.none()),
        supportsAck: true,
        supportsTransferables: false,
        supportsSpanPropagation: true,
      } as const
    }),
  )
}

export async function registerRuntimeRpcServer<PE, AE>(input: {
  publicLayer: Layer.Layer<Rpc.ToHandler<RuntimePublicRpc> | Rpc.Middleware<RuntimePublicRpc>, PE, never>
  adminLayer: Layer.Layer<Rpc.ToHandler<RuntimeAdminRpc> | Rpc.Middleware<RuntimeAdminRpc>, AE, never>
}) {
  runtimeServerLog("server.register.start")
  const scope = await Effect.runPromise(Scope.make())

  const policy = RuntimeRpcAccessPolicy

  const publicProtocol = await Effect.runPromise(
    protocolForRole({
      role: "public",
      portName: RUNTIME_PUBLIC_RPC_PORT_NAME,
      policy,
    }).pipe(Scope.extend(scope)),
  )

  const adminProtocol = await Effect.runPromise(
    protocolForRole({
      role: "admin",
      portName: RUNTIME_ADMIN_RPC_PORT_NAME,
      policy,
    }).pipe(Scope.extend(scope)),
  )

  await Effect.runPromise(
    RpcServer.make(RuntimePublicRpcGroup, {
      disableTracing: true,
    }).pipe(
      Effect.provide(input.publicLayer),
      Effect.provideService(RpcServer.Protocol, publicProtocol),
      Effect.forkScoped,
      Scope.extend(scope),
    ),
  )

  await Effect.runPromise(
    RpcServer.make(RuntimeAdminRpcGroup, {
      disableTracing: true,
    }).pipe(
      Effect.provide(input.adminLayer),
      Effect.provideService(RpcServer.Protocol, adminProtocol),
      Effect.forkScoped,
      Scope.extend(scope),
    ),
  )

  runtimeServerLog("server.register.ready")

  return () =>
    Effect.runPromise(
      Scope.close(scope, Exit.succeed(undefined)),
    ).then(() => {
      runtimeServerLog("server.register.closed")
    })
}

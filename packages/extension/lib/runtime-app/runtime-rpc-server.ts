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
import { RUNTIME_RPC_PORT_NAME, RuntimeRpcGroup, type RuntimeRpc } from "@llm-bridge/contracts"

type RuntimePort = ReturnType<typeof browser.runtime.connect>
const RUNTIME_RPC_SERVER_LOG_PREFIX = "[runtime-rpc-background]"

type RuntimePortSession = {
  readonly port: RuntimePort
  readonly onMessage: Parameters<RuntimePort["onMessage"]["addListener"]>[0]
  readonly onDisconnect: Parameters<RuntimePort["onDisconnect"]["addListener"]>[0]
}

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

export async function registerRuntimeRpcServer<E>(
  layer: Layer.Layer<Rpc.ToHandler<RuntimeRpc> | Rpc.Middleware<RuntimeRpc>, E, never>,
) {
  runtimeServerLog("server.register.start")
  const scope = await Effect.runPromise(Scope.make())

  let nextClientId = 0
  const sessions = new Map<number, RuntimePortSession>()
  const connectedClientIds = new Set<number>()

  const protocol = await Effect.runPromise(
    RpcServer.Protocol.make((writeRequest) =>
      Effect.gen(function*() {
        const disconnects = yield* Mailbox.make<number>()

        const cleanupSession = (clientId: number, reason: string) => {
          const session = sessions.get(clientId)
          if (!session) return

          runtimeServerLog("transport.session.cleanup", {
            clientId,
            reason,
          })

          session.port.onMessage.removeListener(session.onMessage)
          session.port.onDisconnect.removeListener(session.onDisconnect)
          sessions.delete(clientId)
          connectedClientIds.delete(clientId)
        }

        const onConnect: Parameters<typeof browser.runtime.onConnect.addListener>[0] = (port) => {
          if (port.name !== RUNTIME_RPC_PORT_NAME) return

          const clientId = ++nextClientId

          const onMessage: Parameters<typeof port.onMessage.addListener>[0] = (payload: FromClientEncoded) => {
            runtimeServerLog("transport.inbound", {
              clientId,
              message: summarizeRpcMessage(payload),
            })

            void Effect.runPromise(writeRequest(clientId, payload)).catch((error) => {
              console.warn("runtime rpc write failed", error)
            })
          }

          const onDisconnect: Parameters<typeof port.onDisconnect.addListener>[0] = () => {
            runtimeServerLog("transport.disconnected", {
              clientId,
              lastError: browser.runtime.lastError?.message,
            })
            cleanupSession(clientId, "port-disconnect")
            void Effect.runPromise(disconnects.offer(clientId)).catch(() => undefined)
          }

          sessions.set(clientId, {
            port,
            onMessage,
            onDisconnect,
          })
          connectedClientIds.add(clientId)

          runtimeServerLog("transport.connected", {
            clientId,
            portName: port.name,
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
                clientId,
                message: summarizeRpcMessage(response),
              })

              try {
                session.port.postMessage(response)
              } catch (error) {
                runtimeServerLog("transport.outbound.postMessageFailed", {
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
    ).pipe(Scope.extend(scope)),
  )

  await Effect.runPromise(
    RpcServer.make(RuntimeRpcGroup, {
      disableTracing: true,
    }).pipe(
      Effect.provide(layer),
      Effect.provideService(RpcServer.Protocol, protocol),
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

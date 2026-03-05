import { browser } from "@wxt-dev/browser"
import * as RpcClient from "@effect/rpc/RpcClient"
import { RpcClientError } from "@effect/rpc/RpcClientError"
import type { FromClientEncoded, FromServerEncoded } from "@effect/rpc/RpcMessage"
import * as Effect from "effect/Effect"
import * as Scope from "effect/Scope"
import * as Exit from "effect/Exit"
import * as Stream from "effect/Stream"
import { RUNTIME_RPC_PORT_NAME, RuntimeRpcGroup, type RuntimeRpc } from "@llm-bridge/contracts"

type RuntimePort = ReturnType<typeof browser.runtime.connect>

type RuntimeClient = Effect.Effect.Success<ReturnType<typeof RpcClient.make<RuntimeRpc>>>

type RuntimeConnection = {
  connectionId: number
  scope: Scope.CloseableScope
  port: RuntimePort
  client: RuntimeClient
  onDisconnect: Parameters<RuntimePort["onDisconnect"]["addListener"]>[0]
}

type RuntimeRpcClient = RuntimeConnection["client"]
type RuntimeRpcInput<K extends keyof RuntimeRpcClient> = Parameters<RuntimeRpcClient[K]>[0]

let connection: RuntimeConnection | null = null
let nextRuntimeConnectionId = 0
const RUNTIME_RPC_LOG_PREFIX = "[runtime-rpc-content]"

function toLogString(meta: unknown) {
  if (meta === undefined) return ""
  if (typeof meta === "string") return meta

  try {
    return JSON.stringify(meta, (_key, value) => (typeof value === "bigint" ? value.toString() : value))
  } catch {
    return String(meta)
  }
}

function runtimeRpcLog(event: string, meta?: unknown) {
  console.info(RUNTIME_RPC_LOG_PREFIX, new Date().toISOString(), event, toLogString(meta))
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

function summarizeValue(value: unknown) {
  if (Array.isArray(value)) {
    return { type: "array", length: value.length }
  }

  if (isRecord(value)) {
    return { type: "object", keys: Object.keys(value) }
  }

  return { type: typeof value, value }
}

async function disposeConnection(reason: string) {
  runtimeRpcLog("connection.dispose.start", {
    reason,
    hasConnection: connection !== null,
    connectionId: connection?.connectionId,
  })

  if (!connection) return

  const current = connection
  connection = null

  current.port.onDisconnect.removeListener(current.onDisconnect)

  await Effect.runPromise(Scope.close(current.scope, Exit.succeed(undefined))).catch(() => undefined)
  try {
    current.port.disconnect()
  } catch {
    // ignored
  }

  runtimeRpcLog("connection.dispose.complete", {
    reason,
    connectionId: current.connectionId,
  })
}

async function ensureConnection(): Promise<RuntimeConnection> {
  if (connection) {
    runtimeRpcLog("connection.reuse", {
      connectionId: connection.connectionId,
    })
    return connection
  }

  runtimeRpcLog("connection.create.start")
  const connectionId = ++nextRuntimeConnectionId

  const scope = await Effect.runPromise(Scope.make())
  const port = browser.runtime.connect({
    name: RUNTIME_RPC_PORT_NAME,
  })
  runtimeRpcLog("connection.port.opened", { name: port.name })

  const protocol = await Effect.runPromise(
    RpcClient.Protocol.make((writeResponse) =>
      Effect.gen(function*() {
        const onMessage: Parameters<typeof port.onMessage.addListener>[0] = (payload: FromServerEncoded) => {
          runtimeRpcLog("transport.inbound", {
            connectionId,
            message: summarizeRpcMessage(payload),
          })

          void Effect.runPromise(writeResponse(payload)).catch((error) => {
            console.warn("runtime rpc: failed to process server message", error)
          })
        }

        port.onMessage.addListener(onMessage)

        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            port.onMessage.removeListener(onMessage)
          }),
        )

        return {
          send: (message: FromClientEncoded) =>
            Effect.try({
              try: () => {
                runtimeRpcLog("transport.outbound", {
                  connectionId,
                  message: summarizeRpcMessage(message),
                })
                port.postMessage(message)
              },
              catch: (cause) =>
                new RpcClientError({
                  reason: "Protocol",
                  message: "Failed to post runtime RPC message",
                  cause,
                }),
            }),
          supportsAck: true,
          supportsTransferables: false,
        } as const
      }),
    ).pipe(Scope.extend(scope)),
  )

  const client = await Effect.runPromise(
    RpcClient.make(RuntimeRpcGroup, {
      disableTracing: true,
    }).pipe(
      Effect.provideService(RpcClient.Protocol, protocol),
      Scope.extend(scope),
    ),
  )

  const onDisconnect: Parameters<typeof port.onDisconnect.addListener>[0] = () => {
    runtimeRpcLog("transport.disconnected", {
      lastError: browser.runtime.lastError?.message,
      connectionId,
    })
    void disposeConnection("port-disconnect")
  }

  const nextConnection: RuntimeConnection = {
    connectionId,
    scope,
    port,
    client,
    onDisconnect,
  }

  port.onDisconnect.addListener(onDisconnect)
  runtimeRpcLog("connection.listeners.attached")

  if (typeof window !== "undefined") {
    runtimeRpcLog("connection.pagehide.listener.attached")
    window.addEventListener(
      "pagehide",
      () => {
        runtimeRpcLog("connection.pagehide.triggered")
        void disposeConnection("pagehide")
      },
      { once: true },
    )
  }

  connection = nextConnection
  runtimeRpcLog("connection.create.success", { connectionId })
  return nextConnection
}

async function runEffect<A, E>(
  effect: Effect.Effect<A, E, never>,
  operation: string,
): Promise<A> {
  runtimeRpcLog(`${operation}.start`)
  return Effect.runPromise(effect)
    .then((value) => {
      runtimeRpcLog(`${operation}.success`, summarizeValue(value))
      return value
    })
    .catch((error) => {
      runtimeRpcLog(`${operation}.failure`, {
        message: error instanceof Error ? error.message : String(error),
      })
      console.error("runtime rpc: request failed", error)
      throw error
    })
}

function runStream<A, E>(
  stream: Stream.Stream<A, E, never>,
  operation: string,
) {
  runtimeRpcLog(`${operation}.stream.start`)
  return Stream.toAsyncIterable(stream)
}

export function getRuntimeRPC() {
  return {
    async listProviders(input: RuntimeRpcInput<"listProviders">) {
      const { client } = await ensureConnection()
      return runEffect(client.listProviders(input), "listProviders")
    },
    async listModels(input: RuntimeRpcInput<"listModels">) {
      const { client } = await ensureConnection()
      return runEffect(client.listModels(input), "listModels")
    },
    async listConnectedModels(input: RuntimeRpcInput<"listConnectedModels">) {
      const { client } = await ensureConnection()
      return runEffect(client.listConnectedModels(input), "listConnectedModels")
    },
    async getOriginState(input: RuntimeRpcInput<"getOriginState">) {
      const { client } = await ensureConnection()
      return runEffect(client.getOriginState(input), "getOriginState")
    },
    async listPermissions(input: RuntimeRpcInput<"listPermissions">) {
      const { client } = await ensureConnection()
      return runEffect(client.listPermissions(input), "listPermissions")
    },
    async listPending(input: RuntimeRpcInput<"listPending">) {
      const { client } = await ensureConnection()
      return runEffect(client.listPending(input), "listPending")
    },
    async openProviderAuthWindow(input: RuntimeRpcInput<"openProviderAuthWindow">) {
      const { client } = await ensureConnection()
      return runEffect(client.openProviderAuthWindow(input), "openProviderAuthWindow")
    },
    async getProviderAuthFlow(input: RuntimeRpcInput<"getProviderAuthFlow">) {
      const { client } = await ensureConnection()
      return runEffect(client.getProviderAuthFlow(input), "getProviderAuthFlow")
    },
    async startProviderAuthFlow(input: RuntimeRpcInput<"startProviderAuthFlow">) {
      const { client } = await ensureConnection()
      return runEffect(client.startProviderAuthFlow(input), "startProviderAuthFlow")
    },
    async cancelProviderAuthFlow(input: RuntimeRpcInput<"cancelProviderAuthFlow">) {
      const { client } = await ensureConnection()
      return runEffect(client.cancelProviderAuthFlow(input), "cancelProviderAuthFlow")
    },
    async disconnectProvider(input: RuntimeRpcInput<"disconnectProvider">) {
      const { client } = await ensureConnection()
      return runEffect(client.disconnectProvider(input), "disconnectProvider")
    },
    async updatePermission(input: RuntimeRpcInput<"updatePermission">) {
      const { client } = await ensureConnection()
      return runEffect(client.updatePermission(input), "updatePermission")
    },
    async requestPermission(input: RuntimeRpcInput<"requestPermission">) {
      const { client } = await ensureConnection()
      return runEffect(client.requestPermission(input), "requestPermission")
    },
    async acquireModel(input: RuntimeRpcInput<"acquireModel">) {
      const { client } = await ensureConnection()
      return runEffect(client.acquireModel(input), "acquireModel")
    },
    async modelDoGenerate(input: RuntimeRpcInput<"modelDoGenerate">) {
      const { client } = await ensureConnection()
      return runEffect(client.modelDoGenerate(input), "modelDoGenerate")
    },
    modelDoStream(input: RuntimeRpcInput<"modelDoStream">) {
      return {
        async *[Symbol.asyncIterator]() {
          const { client } = await ensureConnection()
          runtimeRpcLog("modelDoStream.start", summarizeValue(input))
          const stream = runStream(client.modelDoStream(input), "modelDoStream")
          for await (const chunk of stream) {
            runtimeRpcLog("modelDoStream.chunk", summarizeValue(chunk))
            yield chunk
          }
          runtimeRpcLog("modelDoStream.complete")
        },
      }
    },
    async abortModelCall(input: RuntimeRpcInput<"abortModelCall">) {
      const { client } = await ensureConnection()
      await runEffect(client.abortModelCall(input), "abortModelCall")
    },
  }
}

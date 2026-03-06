import { browser } from "@wxt-dev/browser"
import * as RpcClient from "@effect/rpc/RpcClient"
import { RpcClientError } from "@effect/rpc/RpcClientError"
import type { FromClientEncoded, FromServerEncoded } from "@effect/rpc/RpcMessage"
import * as Effect from "effect/Effect"
import * as Scope from "effect/Scope"
import * as Exit from "effect/Exit"
import * as Stream from "effect/Stream"
import {
  RUNTIME_ADMIN_RPC_PORT_NAME,
  RuntimeAdminRpcGroup,
  type RuntimeAdminRpc,
} from "@llm-bridge/contracts"

type RuntimePort = ReturnType<typeof browser.runtime.connect>

type RuntimeClient = Effect.Effect.Success<ReturnType<typeof RpcClient.make<RuntimeAdminRpc>>>

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

async function disposeConnection(_reason: string) {
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
}

async function ensureConnection(): Promise<RuntimeConnection> {
  if (connection) return connection

  const connectionId = ++nextRuntimeConnectionId

  const scope = await Effect.runPromise(Scope.make())
  const port = browser.runtime.connect({
    name: RUNTIME_ADMIN_RPC_PORT_NAME,
  })

  const protocol = await Effect.runPromise(
    RpcClient.Protocol.make((writeResponse) =>
      Effect.gen(function*() {
        const onMessage: Parameters<typeof port.onMessage.addListener>[0] = (payload: FromServerEncoded) => {
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
    RpcClient.make(RuntimeAdminRpcGroup, {
      disableTracing: true,
    }).pipe(
      Effect.provideService(RpcClient.Protocol, protocol),
      Scope.extend(scope),
    ),
  )

  const onDisconnect: Parameters<typeof port.onDisconnect.addListener>[0] = () => {
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

  if (typeof window !== "undefined") {
    window.addEventListener(
      "pagehide",
      () => {
        void disposeConnection("pagehide")
      },
      { once: true },
    )
  }

  connection = nextConnection
  return nextConnection
}

async function runEffect<A, E>(effect: Effect.Effect<A, E, never>): Promise<A> {
  return Effect.runPromise(effect)
    .then((value) => value)
    .catch((error) => {
      console.error("runtime rpc: request failed", error)
      throw error
    })
}

function runStream<A, E>(stream: Stream.Stream<A, E, never>) {
  return Stream.toAsyncIterable(stream)
}

export function getRuntimeAdminRPC() {
  return {
    async listProviders(input: RuntimeRpcInput<"listProviders">) {
      const { client } = await ensureConnection()
      return runEffect(client.listProviders(input))
    },
    async listModels(input: RuntimeRpcInput<"listModels">) {
      const { client } = await ensureConnection()
      return runEffect(client.listModels(input))
    },
    async listConnectedModels(input: RuntimeRpcInput<"listConnectedModels">) {
      const { client } = await ensureConnection()
      return runEffect(client.listConnectedModels(input))
    },
    async getOriginState(input: RuntimeRpcInput<"getOriginState">) {
      const { client } = await ensureConnection()
      return runEffect(client.getOriginState(input))
    },
    async listPermissions(input: RuntimeRpcInput<"listPermissions">) {
      const { client } = await ensureConnection()
      return runEffect(client.listPermissions(input))
    },
    async listPending(input: RuntimeRpcInput<"listPending">) {
      const { client } = await ensureConnection()
      return runEffect(client.listPending(input))
    },
    async openProviderAuthWindow(input: RuntimeRpcInput<"openProviderAuthWindow">) {
      const { client } = await ensureConnection()
      return runEffect(client.openProviderAuthWindow(input))
    },
    async getProviderAuthFlow(input: RuntimeRpcInput<"getProviderAuthFlow">) {
      const { client } = await ensureConnection()
      return runEffect(client.getProviderAuthFlow(input))
    },
    async startProviderAuthFlow(input: RuntimeRpcInput<"startProviderAuthFlow">) {
      const { client } = await ensureConnection()
      return runEffect(client.startProviderAuthFlow(input))
    },
    async cancelProviderAuthFlow(input: RuntimeRpcInput<"cancelProviderAuthFlow">) {
      const { client } = await ensureConnection()
      return runEffect(client.cancelProviderAuthFlow(input))
    },
    async disconnectProvider(input: RuntimeRpcInput<"disconnectProvider">) {
      const { client } = await ensureConnection()
      return runEffect(client.disconnectProvider(input))
    },
    async updatePermission(input: RuntimeRpcInput<"updatePermission">) {
      const { client } = await ensureConnection()
      return runEffect(client.updatePermission(input))
    },
    async requestPermission(input: RuntimeRpcInput<"requestPermission">) {
      const { client } = await ensureConnection()
      return runEffect(client.requestPermission(input))
    },
    async acquireModel(input: RuntimeRpcInput<"acquireModel">) {
      const { client } = await ensureConnection()
      return runEffect(client.acquireModel(input))
    },
    async modelDoGenerate(input: RuntimeRpcInput<"modelDoGenerate">) {
      const { client } = await ensureConnection()
      return runEffect(client.modelDoGenerate(input))
    },
    modelDoStream(input: RuntimeRpcInput<"modelDoStream">) {
      return {
        async *[Symbol.asyncIterator]() {
          const { client } = await ensureConnection()
          const stream = runStream(client.modelDoStream(input))
          for await (const chunk of stream) {
            yield chunk
          }
        },
      }
    },
    async abortModelCall(input: RuntimeRpcInput<"abortModelCall">) {
      const { client } = await ensureConnection()
      await runEffect(client.abortModelCall(input))
    },
  }
}

// Backward compatibility for existing imports.
export const getRuntimeRPC = getRuntimeAdminRPC

import { browser } from "@wxt-dev/browser"
import * as RpcClient from "@effect/rpc/RpcClient"
import * as Effect from "effect/Effect"
import * as Scope from "effect/Scope"
import * as Exit from "effect/Exit"
import * as Stream from "effect/Stream"
import { RUNTIME_RPC_PORT_NAME, RuntimeRpcGroup, type RuntimeRpc } from "@llm-bridge/contracts"
import {
  fromRuntimeRpcServerWireMessage,
  toRuntimeRpcClientWireMessage,
  type RuntimeRpcServerWireMessage,
} from "@/lib/runtime/rpc/runtime-rpc-wire"

type RuntimePort = ReturnType<typeof browser.runtime.connect>

type RuntimeConnection = {
  scope: Scope.CloseableScope
  port: RuntimePort
  client: Effect.Effect.Success<ReturnType<typeof RpcClient.makeNoSerialization<RuntimeRpc, never>>>["client"]
  write: Effect.Effect.Success<ReturnType<typeof RpcClient.makeNoSerialization<RuntimeRpc, never>>>["write"]
}

type RuntimeRpcClient = RuntimeConnection["client"]
type RuntimeRpcInput<K extends keyof RuntimeRpcClient> = Parameters<RuntimeRpcClient[K]>[0]

let connection: RuntimeConnection | null = null

async function disposeConnection() {
  if (!connection) return

  const current = connection
  connection = null

  await Effect.runPromise(Scope.close(current.scope, Exit.succeed(undefined))).catch(() => undefined)
  try {
    current.port.disconnect()
  } catch {
    // ignored
  }
}

async function ensureConnection(): Promise<RuntimeConnection> {
  if (connection) return connection

  const scope = await Effect.runPromise(Scope.make())
  const port = browser.runtime.connect({
    name: RUNTIME_RPC_PORT_NAME,
  })

  const { client, write } = await Effect.runPromise(
    RpcClient.makeNoSerialization(RuntimeRpcGroup, {
      supportsAck: true,
      onFromClient: ({ message }) =>
        Effect.sync(() => {
          port.postMessage(toRuntimeRpcClientWireMessage(message))
        }),
      disableTracing: true,
    }).pipe(Scope.extend(scope)),
  )

  const nextConnection: RuntimeConnection = {
    scope,
    port,
    client,
    write,
  }

  const onMessage: Parameters<typeof port.onMessage.addListener>[0] = (payload: RuntimeRpcServerWireMessage) => {
    void Effect.runPromise(write(fromRuntimeRpcServerWireMessage(payload))).catch((error) => {
      console.warn("runtime rpc: failed to process server message", error)
    })
  }

  const onDisconnect: Parameters<typeof port.onDisconnect.addListener>[0] = () => {
    port.onMessage.removeListener(onMessage)
    void disposeConnection()
  }

  port.onMessage.addListener(onMessage)
  port.onDisconnect.addListener(onDisconnect)

  if (typeof window !== "undefined") {
    window.addEventListener(
      "pagehide",
      () => {
        void disposeConnection()
      },
      { once: true },
    )
  }

  connection = nextConnection
  return nextConnection
}

async function runEffect<A, E>(
  effect: Effect.Effect<A, E, Scope.Scope | never>,
): Promise<A> {
  return Effect.runPromise(Effect.scoped(effect)).catch((error) => {
    console.error("runtime rpc: request failed", error)
    throw error
  })
}

function runStream<A, E>(
  stream: Stream.Stream<A, E, never>,
) {
  return Stream.toAsyncIterable(stream)
}

export function getRuntimeRPC() {
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

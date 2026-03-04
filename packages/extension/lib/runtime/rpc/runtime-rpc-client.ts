import { browser } from "@wxt-dev/browser"
import * as RpcClient from "@effect/rpc/RpcClient"
import * as Effect from "effect/Effect"
import * as Scope from "effect/Scope"
import * as Exit from "effect/Exit"
import * as Stream from "effect/Stream"
import { RuntimeRpcGroup, type RuntimeRpc } from "@llm-bridge/contracts"
import { decodeServerMessage, encodeClientMessage } from "@/lib/rpc/rpc-wire"
import { RUNTIME_RPC_PORT_NAME, type RuntimeRPCService } from "@/lib/runtime/rpc/runtime-rpc-types"

type RuntimePort = ReturnType<typeof browser.runtime.connect>

type RuntimeConnection = {
  scope: Scope.CloseableScope
  port: RuntimePort
  client: Effect.Effect.Success<ReturnType<typeof RpcClient.makeNoSerialization<RuntimeRpc, never>>>["client"]
  write: Effect.Effect.Success<ReturnType<typeof RpcClient.makeNoSerialization<RuntimeRpc, never>>>["write"]
}

let connection: RuntimeConnection | null = null

async function disposeConnection() {
  if (!connection) return

  const current = connection
  connection = null

  try {
    await Effect.runPromise(Scope.close(current.scope, Exit.succeed(undefined)))
  } catch {
    // Ignore scope close failures during teardown.
  }

  try {
    current.port.disconnect()
  } catch {
    // Ignore disconnect failures when port is already closed.
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
          port.postMessage(encodeClientMessage(message))
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

  const onMessage: Parameters<typeof port.onMessage.addListener>[0] = (payload) => {
    const decoded = decodeServerMessage<RuntimeRpc>(payload)
    if (!decoded) {
      console.warn("runtime rpc: invalid server message", payload)
      return
    }

    void Effect.runPromise(write(decoded)).catch((error) => {
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
  return Effect.runPromise(Effect.scoped(effect))
}

async function runStream<A, E>(
  stream: Stream.Stream<A, E, never>,
): Promise<AsyncIterable<A>> {
  const readable = await Effect.runPromise(Effect.scoped(Stream.toReadableStreamEffect(stream)))
  return {
    async *[Symbol.asyncIterator]() {
      const reader = readable.getReader()
      try {
        while (true) {
          const chunk = await reader.read()
          if (chunk.done) return
          yield chunk.value
        }
      } finally {
        reader.releaseLock()
      }
    },
  }
}

export function getRuntimeRPC(): RuntimeRPCService {
  return {
    async listProviders(input) {
      const { client } = await ensureConnection()
      return runEffect(client.listProviders(input))
    },
    async listModels(input) {
      const { client } = await ensureConnection()
      return runEffect(client.listModels(input))
    },
    async listConnectedModels(input) {
      const { client } = await ensureConnection()
      return runEffect(client.listConnectedModels(input))
    },
    async getOriginState(input) {
      const { client } = await ensureConnection()
      return runEffect(client.getOriginState(input))
    },
    async listPermissions(input) {
      const { client } = await ensureConnection()
      return runEffect(client.listPermissions(input))
    },
    async listPending(input) {
      const { client } = await ensureConnection()
      return runEffect(client.listPending(input))
    },
    async openProviderAuthWindow(input) {
      const { client } = await ensureConnection()
      return runEffect(client.openProviderAuthWindow(input))
    },
    async getProviderAuthFlow(input) {
      const { client } = await ensureConnection()
      return runEffect(client.getProviderAuthFlow(input))
    },
    async startProviderAuthFlow(input) {
      const { client } = await ensureConnection()
      return runEffect(client.startProviderAuthFlow(input))
    },
    async cancelProviderAuthFlow(input) {
      const { client } = await ensureConnection()
      return runEffect(client.cancelProviderAuthFlow(input))
    },
    async disconnectProvider(input) {
      const { client } = await ensureConnection()
      return runEffect(client.disconnectProvider(input))
    },
    async updatePermission(input) {
      const { client } = await ensureConnection()
      return runEffect(client.updatePermission(input))
    },
    async requestPermission(input) {
      const { client } = await ensureConnection()
      return runEffect(client.requestPermission(input))
    },
    async acquireModel(input) {
      const { client } = await ensureConnection()
      return runEffect(client.acquireModel(input))
    },
    async modelDoGenerate(input) {
      const { client } = await ensureConnection()
      return runEffect(client.modelDoGenerate(input))
    },
    modelDoStream(input) {
      return {
        async *[Symbol.asyncIterator]() {
          const { client } = await ensureConnection()
          const stream = await runStream(client.modelDoStream(input))
          for await (const chunk of stream) {
            yield chunk
          }
        },
      }
    },
    async abortModelCall(input) {
      const { client } = await ensureConnection()
      await runEffect(client.abortModelCall(input))
    },
  }
}

import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"
import {
  RUNTIME_ADMIN_RPC_PORT_NAME,
  RuntimeValidationError,
  RuntimeAdminRpcGroup,
  type RuntimeAdminRpc,
} from "@llm-bridge/contracts"
import {
  makeRuntimeRpcClientCore,
  type RuntimeConnection,
} from "./runtime-rpc-client-core"

const CONNECTION_INVALIDATED_MESSAGE =
  "Runtime connection was destroyed while connecting"

type RuntimeClient = RuntimeConnection<RuntimeAdminRpc>["client"]
type RuntimeConnectionState = RuntimeConnection<RuntimeAdminRpc>

type RuntimeRpcClient = RuntimeClient
type RuntimeRpcInput<K extends keyof RuntimeRpcClient> = Parameters<RuntimeRpcClient[K]>[0]

const core = makeRuntimeRpcClientCore({
  portName: RUNTIME_ADMIN_RPC_PORT_NAME,
  rpcGroup: RuntimeAdminRpcGroup,
  invalidatedError: () =>
    new RuntimeValidationError({
      message: CONNECTION_INVALIDATED_MESSAGE,
    }),
})

async function ensureConnection(): Promise<RuntimeConnectionState> {
  return core.ensureConnection()
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

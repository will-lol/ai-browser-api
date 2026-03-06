import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"
import {
  RUNTIME_PUBLIC_RPC_PORT_NAME,
  RuntimeValidationError,
  RuntimePublicRpcGroup,
  type RuntimePublicRpc,
} from "@llm-bridge/contracts"
import {
  makeRuntimeRpcClientCore,
  type RuntimeConnection,
} from "./runtime-rpc-client-core"

const CONNECTION_INVALIDATED_MESSAGE =
  "Runtime connection was destroyed while connecting"

type RuntimeClient = RuntimeConnection<RuntimePublicRpc>["client"]
type RuntimeConnectionState = RuntimeConnection<RuntimePublicRpc>

type RuntimeRpcClient = RuntimeClient
type RuntimeRpcInput<K extends keyof RuntimeRpcClient> = Parameters<RuntimeRpcClient[K]>[0]

const core = makeRuntimeRpcClientCore({
  portName: RUNTIME_PUBLIC_RPC_PORT_NAME,
  rpcGroup: RuntimePublicRpcGroup,
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

export function getRuntimePublicRPC() {
  return {
    async listModels(input: RuntimeRpcInput<"listModels">) {
      const { client } = await ensureConnection()
      return runEffect(client.listModels(input))
    },
    async getOriginState(input: RuntimeRpcInput<"getOriginState">) {
      const { client } = await ensureConnection()
      return runEffect(client.getOriginState(input))
    },
    async listPending(input: RuntimeRpcInput<"listPending">) {
      const { client } = await ensureConnection()
      return runEffect(client.listPending(input))
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

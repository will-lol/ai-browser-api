import {
  PAGE_BRIDGE_INIT_MESSAGE,
  PAGE_BRIDGE_READY_EVENT,
  PageBridgeRpcGroup,
  type BridgeListModelsResponse,
  type BridgeModelDescriptorResponse,
  type PageBridgeRpc,
  type BridgePermissionRequest,
  type BridgeStateResponse,
  type JsonValue,
  type RuntimeCreatePermissionRequestResponse,
  type RuntimeDismissPermissionRequestResponse,
  type RuntimeGenerateResponse,
  type RuntimeModelSummary,
  type RuntimeResolvePermissionRequestResponse,
  type RuntimeStreamPart,
} from "@llm-bridge/contracts"
import * as RpcClient from "@effect/rpc/RpcClient"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import { decodeServerMessage, encodeClientMessage } from "./rpc-wire"

const DEFAULT_TIMEOUT_MS = 30_000

type PageBridgeConnection = Effect.Effect.Success<
  ReturnType<typeof RpcClient.makeNoSerialization<PageBridgeRpc, never>>
>

type PageBridgeClient = PageBridgeConnection["client"]

type PageBridgeWriter = PageBridgeConnection["write"]

export type BridgeClientOptions = {
  timeoutMs?: number
  debug?: boolean
  logger?: (...args: unknown[]) => void
}

export type BridgeModelSummary = RuntimeModelSummary
export type BridgeGenerateResponse = RuntimeGenerateResponse
export type BridgeStreamPart = RuntimeStreamPart
export type BridgePermissionResult =
  | RuntimeCreatePermissionRequestResponse
  | RuntimeDismissPermissionRequestResponse
  | RuntimeResolvePermissionRequestResponse

export type BridgeModelCallOptions = Record<string, JsonValue> & {
  abortSignal?: AbortSignal
}

export type BridgeLanguageModel = BridgeModelDescriptorResponse & {
  doGenerate: (options?: BridgeModelCallOptions) => Promise<BridgeGenerateResponse>
  doStream: (options?: BridgeModelCallOptions) => Promise<{ stream: ReadableStream<BridgeStreamPart> }>
}

export type BridgeClient = {
  listModels: () => Promise<ReadonlyArray<BridgeModelSummary>>
  getModel: (modelId: string) => Promise<BridgeLanguageModel>
  getState: () => Promise<BridgeStateResponse>
  requestPermission: (payload?: BridgePermissionRequest) => Promise<BridgePermissionResult>
  abort: (requestId: string) => Promise<void>
  destroy: () => Promise<void>
}

type BridgeConnection = {
  scope: Scope.CloseableScope
  port: MessagePort
  client: PageBridgeClient
  write: PageBridgeWriter
  detach: () => void
}

function createAbortError() {
  const error = new Error("The operation was aborted")
  error.name = "AbortError"
  return error
}

function log(debug: boolean, logger: (...args: unknown[]) => void, event: string, meta?: unknown) {
  if (!debug) return
  logger("[llm-bridge-client]", new Date().toISOString(), event, meta ?? {})
}

function waitForBridgeReady(timeoutMs: number) {
  return new Promise<void>((resolve, reject) => {
    if (typeof window === "undefined") {
      resolve()
      return
    }

    if (document.documentElement.dataset.llmBridgeReady === "true") {
      resolve()
      return
    }

    const timer = window.setTimeout(() => {
      cleanup()
      reject(new Error(`Bridge initialization timed out after ${timeoutMs}ms`))
    }, timeoutMs)

    const onReady = () => {
      cleanup()
      resolve()
    }

    const cleanup = () => {
      window.clearTimeout(timer)
      window.removeEventListener(PAGE_BRIDGE_READY_EVENT, onReady)
    }

    window.addEventListener(PAGE_BRIDGE_READY_EVENT, onReady, { once: true })
  })
}

async function createConnection(options: BridgeClientOptions): Promise<BridgeConnection> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const debug = options.debug ?? false
  const logger = options.logger ?? ((...args: unknown[]) => console.info(...args))

  await waitForBridgeReady(timeoutMs)

  const scope = await Effect.runPromise(Scope.make())
  const messageChannel = new MessageChannel()
  const port = messageChannel.port1

  const { client, write } = await Effect.runPromise(
    RpcClient.makeNoSerialization(PageBridgeRpcGroup, {
      supportsAck: true,
      onFromClient: ({ message }) =>
        Effect.sync(() => {
          port.postMessage(encodeClientMessage(message))
        }),
      disableTracing: true,
    }).pipe(Scope.extend(scope)),
  )

  const onMessage = (event: MessageEvent<unknown>) => {
    const decoded = decodeServerMessage<PageBridgeRpc>(event.data)
    if (!decoded) {
      log(debug, logger, "rpc.invalidMessage", event.data)
      return
    }

    void Effect.runPromise(write(decoded)).catch((error) => {
      log(debug, logger, "rpc.writeError", error)
    })
  }

  const onMessageError = (event: MessageEvent<unknown>) => {
    log(debug, logger, "rpc.messageError", event)
  }

  port.addEventListener("message", onMessage)
  port.addEventListener("messageerror", onMessageError)
  port.start()

  window.postMessage({ type: PAGE_BRIDGE_INIT_MESSAGE }, "*", [messageChannel.port2])

  log(debug, logger, "rpc.connected")

  return {
    scope,
    port,
    client,
    write,
    detach() {
      port.removeEventListener("message", onMessage)
      port.removeEventListener("messageerror", onMessageError)
    },
  }
}

function splitAbortSignal(options: BridgeModelCallOptions | undefined) {
  if (!options || typeof options !== "object") {
    return {
      abortSignal: undefined,
      callOptions: {},
    }
  }

  const copy = { ...options }
  const abortSignal = copy.abortSignal
  delete copy.abortSignal

  return {
    abortSignal,
    callOptions: copy,
  }
}

export function createLLMBridgeClient(options: BridgeClientOptions = {}): BridgeClient {
  const debug = options.debug ?? false
  const logger = options.logger ?? ((...args: unknown[]) => console.info(...args))

  let sequence = 0
  let connection: BridgeConnection | null = null
  let connectionPromise: Promise<BridgeConnection> | null = null

  const ensureConnection = async () => {
    if (connection) return connection
    if (!connectionPromise) {
      connectionPromise = createConnection(options).then((value) => {
        connection = value
        return value
      })
    }

    return connectionPromise
  }

  const runEffect = async <A, E>(effect: Effect.Effect<A, E, Scope.Scope | never>) =>
    Effect.runPromise(Effect.scoped(effect))

  const runStream = async <A, E>(stream: Stream.Stream<A, E, never>) =>
    Effect.runPromise(Effect.scoped(Stream.toReadableStreamEffect(stream)))

  const abort = async (requestId: string) => {
    const current = await ensureConnection()
    await runEffect(current.client.abort({ requestId }))
  }

  const createLanguageModel = (modelId: string, descriptor: BridgeModelDescriptorResponse): BridgeLanguageModel => ({
    specificationVersion: descriptor.specificationVersion,
    provider: descriptor.provider,
    modelId: descriptor.modelId,
    supportedUrls: descriptor.supportedUrls,
    async doGenerate(options) {
      const requestId = `req_${Date.now()}_${++sequence}`
      const { abortSignal, callOptions } = splitAbortSignal(options)

      if (abortSignal?.aborted) {
        throw createAbortError()
      }

      const onAbort = () => {
        void abort(requestId)
      }

      abortSignal?.addEventListener("abort", onAbort, { once: true })

      try {
        const current = await ensureConnection()
        return await runEffect(
          current.client.modelDoGenerate({
            requestId,
            sessionID: requestId,
            modelId,
            options: callOptions,
          }),
        )
      } finally {
        abortSignal?.removeEventListener("abort", onAbort)
      }
    },
    async doStream(options) {
      const requestId = `req_${Date.now()}_${++sequence}`
      const { abortSignal, callOptions } = splitAbortSignal(options)

      if (abortSignal?.aborted) {
        throw createAbortError()
      }

      const current = await ensureConnection()
      const stream = await runStream(
        current.client.modelDoStream({
          requestId,
          sessionID: requestId,
          modelId,
          options: callOptions,
        }),
      )

      const reader = stream.getReader()
      const onAbort = () => {
        void abort(requestId)
      }

      abortSignal?.addEventListener("abort", onAbort, { once: true })

      return {
        stream: new ReadableStream<BridgeStreamPart>({
          async pull(controller) {
            const next = await reader.read()
            if (next.done) {
              controller.close()
              return
            }
            controller.enqueue(next.value)
          },
          async cancel() {
            try {
              await reader.cancel()
            } finally {
              abortSignal?.removeEventListener("abort", onAbort)
              void abort(requestId)
            }
          },
        }),
      }
    },
  })

  return {
    async listModels() {
      const current = await ensureConnection()
      const response = await runEffect(current.client.listModels({}))
      return (response as BridgeListModelsResponse).models
    },
    async getModel(modelId: string) {
      if (modelId.length === 0) {
        throw new Error("modelId is required")
      }

      const requestId = `req_${Date.now()}_${++sequence}`
      const current = await ensureConnection()
      const descriptor = await runEffect(
        current.client.getModel({
          modelId,
          requestId,
          sessionID: requestId,
        }),
      )

      return createLanguageModel(modelId, descriptor)
    },
    async getState() {
      const current = await ensureConnection()
      return runEffect(current.client.getState({}))
    },
    async requestPermission(payload = {}) {
      const current = await ensureConnection()
      return runEffect(current.client.requestPermission(payload))
    },
    async abort(requestId: string) {
      if (!requestId) return
      await abort(requestId)
    },
    async destroy() {
      if (!connection) return

      const current = connection
      connection = null
      connectionPromise = null

      current.detach()

      await Effect.runPromise(Scope.close(current.scope, Exit.succeed(undefined)))
      current.port.close()
      log(debug, logger, "rpc.destroyed")
    },
  }
}

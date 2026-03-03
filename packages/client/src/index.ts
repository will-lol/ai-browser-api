import { RPCChannel, type IoInterface } from "kkrpc/browser"
import { MessagePortIO } from "./io"
import type {
  BridgeListModelsResponse,
  BridgeModelDescriptorResponse,
  BridgePermissionRequest as InternalBridgePermissionRequest,
  PageBridgeService,
  SerializedSupportedUrlPattern,
} from "@llm-bridge/extension/lib/bridge/page-rpc-types"

const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_PENDING_WARNING_MS = 5_000
const LOG_PREFIX = "[llm-bridge-client]"

export type BridgeClientOptions = {
  timeoutMs?: number
  debug?: boolean
  pendingWarningMs?: number
  logger?: (...args: unknown[]) => void
}

export type BridgeModelSummary = {
  id: string
  name: string
  provider: string
  capabilities?: unknown
  connected: boolean
}

export type BridgePermissionRequest = {
  modelId?: string
  modelName?: string
  provider?: string
  capabilities?: string[]
}

export type BridgeModelDescriptor = {
  specificationVersion: "v3"
  provider: string
  modelId: string
  supportedUrls: Record<string, RegExp[]>
}

export type BridgeModelCallOptions = Record<string, unknown> & {
  abortSignal?: AbortSignal
}

export type BridgeLanguageModel = BridgeModelDescriptor & {
  doGenerate: (options?: BridgeModelCallOptions) => Promise<unknown>
  doStream: (options?: BridgeModelCallOptions) => Promise<{ stream: ReadableStream<unknown> }>
}

export type BridgeClient = {
  listModels: () => Promise<BridgeModelSummary[]>
  getModel: (modelId: string) => Promise<BridgeLanguageModel>
  getState: () => Promise<unknown>
  requestPermission: (payload?: BridgePermissionRequest) => Promise<unknown>
  abort: (requestId: string) => void
  destroy: () => void
}

function createAbortError() {
  const error = new Error("The operation was aborted")
  error.name = "AbortError"
  return error
}

function isAbortSignal(value: unknown): value is AbortSignal {
  return (
    !!value &&
    typeof value === "object" &&
    "aborted" in value &&
    "addEventListener" in value &&
    "removeEventListener" in value
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function summarizeResult(value: unknown): unknown {
  if (Array.isArray(value)) {
    return {
      kind: "array",
      length: value.length,
    }
  }

  if (isRecord(value)) {
    const summary: Record<string, unknown> = {
      kind: "object",
      keys: Object.keys(value).slice(0, 12),
    }

    const models = value.models
    if (Array.isArray(models)) {
      summary.modelsLength = models.length
    }

    if (typeof value.provider === "string") {
      summary.provider = value.provider
    }
    if (typeof value.modelId === "string") {
      summary.modelId = value.modelId
    }

    return summary
  }

  return {
    kind: typeof value,
    value,
  }
}

function toErrorMeta(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      cause: isRecord(error.cause) || error.cause instanceof Error
        ? toErrorMeta(error.cause)
        : error.cause,
    }
  }

  return {
    name: "NonErrorThrown",
    message: String(error),
  }
}

function splitAbortSignal(options: BridgeModelCallOptions | undefined) {
  if (!options || typeof options !== "object") {
    return { callOptions: {}, abortSignal: undefined }
  }

  const copy = { ...options }
  const signal = copy.abortSignal
  delete copy.abortSignal

  return {
    callOptions: copy,
    abortSignal: isAbortSignal(signal) ? signal : undefined,
  }
}

function toSupportedUrls(
  input: Record<string, SerializedSupportedUrlPattern[]> | undefined,
): Record<string, RegExp[]> {
  const supportedUrls: Record<string, RegExp[]> = {}
  if (!input || typeof input !== "object") return supportedUrls

  for (const [mediaType, patterns] of Object.entries(input)) {
    if (!Array.isArray(patterns)) continue

    const compiled = patterns
      .map((pattern) => {
        try {
          return new RegExp(pattern.source, pattern.flags ?? "")
        } catch {
          return null
        }
      })
      .filter((pattern): pattern is RegExp => pattern instanceof RegExp)

    supportedUrls[mediaType] = compiled
  }

  return supportedUrls
}

function createReadableStreamFromIterable(
  iterable: AsyncIterable<unknown>,
  onCancel: () => void,
) {
  const iterator = iterable[Symbol.asyncIterator]()

  return new ReadableStream<unknown>({
    async pull(controller) {
      try {
        const chunk = await iterator.next()
        if (chunk.done) {
          controller.close()
          return
        }

        controller.enqueue(chunk.value)
      } catch (error) {
        controller.error(error instanceof Error ? error : new Error(String(error)))
      }
    },
    cancel() {
      onCancel()
      void iterator.return?.()
    },
  })
}

function summarizeWindowMessagePayload(data: unknown) {
  if (!isRecord(data)) return undefined
  const hasRPCShape =
    "id" in data ||
    "method" in data ||
    "result" in data ||
    "error" in data

  if (!hasRPCShape) return undefined

  return {
    id: data.id ?? null,
    method: typeof data.method === "string" ? data.method : undefined,
    hasResult: "result" in data,
    hasError: "error" in data,
    keys: Object.keys(data).slice(0, 12),
  }
}

function resolveGlobalDebugFlag() {
  const root = globalThis as Record<string, unknown>
  const value = root.__LLM_BRIDGE_DEBUG__
  return typeof value === "boolean" ? value : undefined
}

export function createLLMBridgeClient(options: BridgeClientOptions = {}): BridgeClient {
  let seq = 0
  let opSeq = 0
  let destroyed = false
  const pendingWarningMs = options.pendingWarningMs ?? DEFAULT_PENDING_WARNING_MS
  const globalDebug = resolveGlobalDebugFlag()
  const debugEnabled = options.debug ?? globalDebug ?? true
  const logger = options.logger ?? ((...args: unknown[]) => console.info(...args))

  function nextId() {
    seq += 1
    return `req_${Date.now()}_${seq}`
  }

  function log(event: string, meta?: Record<string, unknown>) {
    if (!debugEnabled) return
    logger(LOG_PREFIX, new Date().toISOString(), event, meta ?? {})
  }

  async function withTrace<T>(
    name: string,
    payload: Record<string, unknown>,
    run: () => Promise<T> | T,
  ): Promise<T> {
    const operationID = `op_${Date.now()}_${++opSeq}`
    const started = Date.now()
    log("call.start", {
      operationID,
      name,
      payload,
    })

    const warningTimer = setTimeout(() => {
      log("call.pending", {
        operationID,
        name,
        elapsedMs: Date.now() - started,
      })
    }, pendingWarningMs)

    try {
      const result = await Promise.resolve(run())
      log("call.success", {
        operationID,
        name,
        elapsedMs: Date.now() - started,
        result: summarizeResult(result),
      })
      return result
    } catch (error) {
      log("call.error", {
        operationID,
        name,
        elapsedMs: Date.now() - started,
        error: toErrorMeta(error),
      })
      throw error
    } finally {
      clearTimeout(warningTimer)
    }
  }

  let channel: RPCChannel<Record<string, never>, PageBridgeService, IoInterface> | null = null
  let api: PageBridgeService | null = null
  
  // Wait for the initialization handshake to complete
  const initializationPromise = new Promise<void>((resolve) => {
    if (typeof window === "undefined") {
      resolve()
      return
    }

    const initBridge = () => {
      const messageChannel = new MessageChannel()
      const io = new MessagePortIO(messageChannel.port1)
      
      channel = new RPCChannel<Record<string, never>, PageBridgeService, IoInterface>(io, {
        expose: {},
        timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      })
      api = channel.getAPI()

      window.postMessage({ type: "llm-bridge-init" }, "*", [messageChannel.port2])
      resolve()
    }

    if (document.documentElement.dataset.llmBridgeReady === "true") {
      initBridge()
    } else {
      window.addEventListener("llm-bridge-ready", initBridge, { once: true })
    }
  })

  // Helper to ensure API is ready before calling
  async function getApi() {
    await initializationPromise
    if (!api) throw new Error("Bridge API not initialized")
    return api
  }

  log("client.init", {
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    pendingWarningMs,
    debugEnabled,
    href: typeof window !== "undefined" ? window.location.href : undefined,
    origin: typeof window !== "undefined" ? window.location.origin : undefined,
  })

  const onWindowMessage = (event: MessageEvent) => {
    const payload = summarizeWindowMessagePayload(event.data)
    if (!payload) return
    log("window.message", {
      ...payload,
      origin: event.origin,
      sourceIsWindow: event.source === window,
    })
  }

  if (typeof window !== "undefined") {
    window.addEventListener("message", onWindowMessage)
  }

  function createLanguageModel(modelId: string, descriptor: BridgeModelDescriptorResponse): BridgeLanguageModel {
    const canonicalModelId = modelId
    const resolvedModelId = descriptor.modelId || canonicalModelId
    const provider = descriptor.provider
    const supportedUrls = toSupportedUrls(descriptor?.supportedUrls)

    log("model.create", {
      requestedModelId: modelId,
      resolvedModelId,
      provider,
      supportedUrlTypes: Object.keys(supportedUrls),
    })

    return {
      specificationVersion: "v3",
      provider,
      modelId: canonicalModelId,
      supportedUrls,
      async doGenerate(options) {
        const { callOptions, abortSignal } = splitAbortSignal(options)
        const requestId = nextId()

        if (abortSignal?.aborted) {
          log("model.doGenerate.abort.pre", {
            requestId,
            modelId: canonicalModelId,
          })
          throw createAbortError()
        }

        const onAbort = async () => {
          log("model.doGenerate.abort.signal", {
            requestId,
            modelId: canonicalModelId,
          })
          const readyApi = await getApi()
          void readyApi.abort({ requestId })
        }

        abortSignal?.addEventListener("abort", onAbort, { once: true })

        try {
          return await withTrace("model.doGenerate", {
            requestId,
            modelId: canonicalModelId,
            optionKeys: Object.keys(callOptions),
          }, async () => {
            const readyApi = await getApi()
            return readyApi.modelDoGenerate({
              requestId,
              modelId: canonicalModelId,
              options: callOptions,
            })
          })
        } finally {
          abortSignal?.removeEventListener("abort", onAbort)
        }
      },
      async doStream(options) {
        const { callOptions, abortSignal } = splitAbortSignal(options)
        const requestId = nextId()

        if (abortSignal?.aborted) {
          log("model.doStream.abort.pre", {
            requestId,
            modelId: canonicalModelId,
          })
          throw createAbortError()
        }

        const streamIterable = await withTrace<AsyncIterable<unknown>>("model.doStream.open", {
          requestId,
          modelId: canonicalModelId,
          optionKeys: Object.keys(callOptions),
        }, async () => {
          const readyApi = await getApi()
          return readyApi.modelDoStream({
            requestId,
            modelId: canonicalModelId,
            options: callOptions,
          })
        })

        const onCancel = async () => {
          log("model.doStream.cancel", {
            requestId,
            modelId: canonicalModelId,
          })
          const readyApi = await getApi()
          void readyApi.abort({ requestId })
        }

        const stream = createReadableStreamFromIterable(streamIterable, onCancel)

        const onAbort = () => {
          log("model.doStream.abort.signal", {
            requestId,
            modelId: canonicalModelId,
          })
          onCancel()
        }

        abortSignal?.addEventListener("abort", onAbort, { once: true })

        let chunkCount = 0
        return {
          stream: new ReadableStream<unknown>({
            start(controller) {
              const reader = stream.getReader()
              const started = Date.now()

              const pump = async () => {
                try {
                  while (true) {
                    const result = await reader.read()
                    if (result.done) {
                      log("model.doStream.complete", {
                        requestId,
                        modelId: canonicalModelId,
                        chunkCount,
                        elapsedMs: Date.now() - started,
                      })
                      controller.close()
                      return
                    }

                    chunkCount += 1
                    if (chunkCount <= 5 || chunkCount % 25 === 0) {
                      log("model.doStream.chunk", {
                        requestId,
                        modelId: canonicalModelId,
                        chunkCount,
                        chunk: summarizeResult(result.value),
                      })
                    }
                    controller.enqueue(result.value)
                  }
                } catch (error) {
                  log("model.doStream.error", {
                    requestId,
                    modelId: canonicalModelId,
                    error: toErrorMeta(error),
                    chunkCount,
                    elapsedMs: Date.now() - started,
                  })
                  controller.error(error instanceof Error ? error : new Error(String(error)))
                } finally {
                  abortSignal?.removeEventListener("abort", onAbort)
                  reader.releaseLock()
                }
              }

              void pump()
            },
            cancel() {
              onCancel()
            },
          }),
        }
      },
    }
  }

  return {
    async listModels() {
      const readyApi = await getApi()
      const response = await withTrace("listModels", {}, () => readyApi.listModels() as Promise<BridgeListModelsResponse>)
      return Array.isArray(response.models) ? response.models : []
    },
    async getModel(modelId) {
      if (typeof modelId !== "string" || modelId.length === 0) {
        throw new Error("modelId is required")
      }

      const readyApi = await getApi()
      const requestId = nextId()
      const descriptor = await withTrace("getModel", {
        requestId,
        modelId,
      }, () =>
        readyApi.getModel({
          modelId,
          requestId,
        }))

      return createLanguageModel(modelId, descriptor as BridgeModelDescriptorResponse)
    },
    async getState() {
      const readyApi = await getApi()
      return withTrace("getState", {}, () => readyApi.getState())
    },
    async requestPermission(payload = {}) {
      const readyApi = await getApi()
      return withTrace("requestPermission", payload as Record<string, unknown>, () =>
        readyApi.requestPermission(payload as InternalBridgePermissionRequest))
    },
    async abort(requestId) {
      if (!requestId) return
      log("abort", {
        requestId,
      })
      const readyApi = await getApi()
      void readyApi.abort({ requestId })
    },
    destroy() {
      if (destroyed) return
      destroyed = true
      log("destroy", {})
      if (typeof window !== "undefined") {
        window.removeEventListener("message", onWindowMessage)
      }
      channel?.destroy()
    },
  }
}

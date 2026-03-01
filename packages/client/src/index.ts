import { IframeChildIO, RPCChannel, type IoInterface } from "kkrpc/browser"
import type {
  BridgeListModelsResponse,
  BridgeModelDescriptorResponse,
  BridgePermissionRequest as InternalBridgePermissionRequest,
  PageBridgeService,
  SerializedSupportedUrlPattern,
} from "@llm-bridge/extension/lib/bridge/page-rpc-types"

const DEFAULT_TIMEOUT_MS = 30_000

export type BridgeClientOptions = {
  timeoutMs?: number
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

export function createLLMBridgeClient(options: BridgeClientOptions = {}): BridgeClient {
  let seq = 0

  function nextId() {
    seq += 1
    return `req_${Date.now()}_${seq}`
  }

  const io = new IframeChildIO()
  const channel = new RPCChannel<Record<string, never>, PageBridgeService, IoInterface>(io, {
    expose: {},
    timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  })

  const api = channel.getAPI()

  function createLanguageModel(modelId: string, descriptor: BridgeModelDescriptorResponse): BridgeLanguageModel {
    const resolvedModelId = descriptor.modelId || modelId
    const provider = descriptor.provider
    const supportedUrls = toSupportedUrls(descriptor?.supportedUrls)

    return {
      specificationVersion: "v3",
      provider,
      modelId: resolvedModelId,
      supportedUrls,
      async doGenerate(options) {
        const { callOptions, abortSignal } = splitAbortSignal(options)
        const requestId = nextId()

        if (abortSignal?.aborted) {
          throw createAbortError()
        }

        const onAbort = () => {
          void api.abort({ requestId })
        }

        abortSignal?.addEventListener("abort", onAbort, { once: true })

        try {
          return await api.modelDoGenerate({
            requestId,
            modelId: resolvedModelId,
            options: callOptions,
          })
        } finally {
          abortSignal?.removeEventListener("abort", onAbort)
        }
      },
      async doStream(options) {
        const { callOptions, abortSignal } = splitAbortSignal(options)
        const requestId = nextId()

        if (abortSignal?.aborted) {
          throw createAbortError()
        }

        const streamIterable = await api.modelDoStream({
          requestId,
          modelId: resolvedModelId,
          options: callOptions,
        })

        const onCancel = () => {
          void api.abort({ requestId })
        }

        const stream = createReadableStreamFromIterable(streamIterable, onCancel)

        const onAbort = () => {
          onCancel()
        }

        abortSignal?.addEventListener("abort", onAbort, { once: true })

        return {
          stream: new ReadableStream<unknown>({
            start(controller) {
              const reader = stream.getReader()

              const pump = async () => {
                try {
                  while (true) {
                    const result = await reader.read()
                    if (result.done) {
                      controller.close()
                      return
                    }
                    controller.enqueue(result.value)
                  }
                } catch (error) {
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
      const response = await api.listModels() as BridgeListModelsResponse
      return Array.isArray(response.models) ? response.models : []
    },
    async getModel(modelId) {
      if (typeof modelId !== "string" || modelId.length === 0) {
        throw new Error("modelId is required")
      }

      const descriptor = await api.getModel({
        modelId,
        requestId: nextId(),
      })

      return createLanguageModel(modelId, descriptor as BridgeModelDescriptorResponse)
    },
    getState() {
      return api.getState()
    },
    requestPermission(payload = {}) {
      return api.requestPermission(payload as InternalBridgePermissionRequest)
    },
    abort(requestId) {
      if (!requestId) return
      void api.abort({ requestId })
    },
    destroy() {
      channel.destroy()
    },
  }
}

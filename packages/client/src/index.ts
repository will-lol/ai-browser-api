const DEFAULT_SOURCE = "llm-bridge-page"
const DEFAULT_TARGET = "llm-bridge-content"

type BridgeMessage = {
  source?: string
  requestId?: string
  type?: string
  ok?: boolean
  payload?: unknown
  error?: string
}

type SerializedSupportedUrlPattern = {
  source: string
  flags?: string
}

type PendingRequest = {
  resolve: (value: any) => void
  reject: (error: Error) => void
  timeoutId: number
}

type StreamHandler = {
  push: (part: unknown) => void
  finish: () => void
  fail: (error: unknown) => void
}

export type BridgeClientOptions = {
  targetWindow?: Window
  timeoutMs?: number
  source?: string
  target?: string
}

export type BridgePermissionRequest = {
  modelId?: string
  modelName?: string
  provider?: string
  capabilities?: string[]
}

export type BridgeModelSummary = {
  id: string
  name: string
  provider: string
  capabilities?: unknown
  connected?: boolean
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
  input: unknown,
): Record<string, RegExp[]> {
  const supportedUrls: Record<string, RegExp[]> = {}
  if (!input || typeof input !== "object") return supportedUrls

  for (const [mediaType, patterns] of Object.entries(input)) {
    if (!Array.isArray(patterns)) continue

    const compiled = patterns
      .map((pattern) => {
        if (pattern instanceof RegExp) return pattern
        if (typeof pattern === "string") return new RegExp(pattern)
        if (!pattern || typeof pattern !== "object") return null

        const serialized = pattern as SerializedSupportedUrlPattern
        if (typeof serialized.source !== "string") return null

        try {
          return new RegExp(serialized.source, typeof serialized.flags === "string" ? serialized.flags : "")
        } catch {
          return null
        }
      })
      .filter((pattern): pattern is RegExp => pattern instanceof RegExp)

    supportedUrls[mediaType] = compiled
  }

  return supportedUrls
}

export function createLLMBridgeClient(options: BridgeClientOptions = {}): BridgeClient {
  const root = options.targetWindow ?? window
  const source = options.source ?? DEFAULT_SOURCE
  const target = options.target ?? DEFAULT_TARGET
  const timeoutMs = options.timeoutMs ?? 30_000

  let seq = 0
  const pending = new Map<string, PendingRequest>()
  const streamHandlers = new Map<string, StreamHandler>()

  function nextId() {
    seq += 1
    return `req_${Date.now()}_${seq}`
  }

  function post(type: string, payload: Record<string, unknown>, requestId?: string) {
    const id = requestId ?? nextId()
    root.postMessage(
      {
        source,
        requestId: id,
        type,
        payload,
      },
      "*",
    )
    return id
  }

  function request<T = unknown>(type: string, payload: Record<string, unknown>, requestId?: string) {
    const id = post(type, payload, requestId)
    return new Promise<T>((resolve, reject) => {
      const timeoutId = root.setTimeout(() => {
        if (!pending.has(id)) return
        pending.delete(id)
        reject(new Error(`Request timed out: ${type}`))
      }, timeoutMs)

      pending.set(id, { resolve, reject, timeoutId })
    })
  }

  function createModelStream(requestId: string, onClose: () => void) {
    const queue: unknown[] = []
    let controller: ReadableStreamDefaultController<unknown> | undefined
    let done = false
    let error: Error | undefined
    let finalized = false

    const finalize = () => {
      if (finalized) return
      finalized = true
      streamHandlers.delete(requestId)
      onClose()
    }

    const flush = () => {
      if (!controller) return

      while (queue.length > 0) {
        controller.enqueue(queue.shift())
      }

      if (error) {
        controller.error(error)
        finalize()
        return
      }

      if (done) {
        controller.close()
        finalize()
      }
    }

    streamHandlers.set(requestId, {
      push(part) {
        if (finalized) return
        if (controller) {
          controller.enqueue(part)
        } else {
          queue.push(part)
        }
      },
      finish() {
        if (finalized) return
        done = true
        flush()
      },
      fail(message) {
        if (finalized) return
        error = message instanceof Error ? message : new Error(String(message || "Stream failed"))
        done = true
        flush()
      },
    })

    return new ReadableStream<unknown>({
      start(nextController) {
        controller = nextController
        flush()
      },
      cancel() {
        finalize()
        post("abort", { requestId }, requestId)
      },
    })
  }

  function createLanguageModel(modelId: string, descriptor: unknown): BridgeLanguageModel {
    const safeDescriptor = descriptor && typeof descriptor === "object"
      ? descriptor as { modelId?: string; provider?: string; supportedUrls?: unknown }
      : undefined

    const resolvedModelId =
      typeof safeDescriptor?.modelId === "string" && safeDescriptor.modelId.length > 0
        ? safeDescriptor.modelId
        : modelId

    const provider =
      typeof safeDescriptor?.provider === "string" && safeDescriptor.provider.length > 0
        ? safeDescriptor.provider
        : "unknown"

    const supportedUrls = toSupportedUrls(safeDescriptor?.supportedUrls)

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
          post("abort", { requestId }, requestId)
        }

        abortSignal?.addEventListener("abort", onAbort, { once: true })

        try {
          return await request("model-do-generate", {
            modelId: resolvedModelId,
            options: callOptions,
          }, requestId)
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

        const onAbort = () => {
          post("abort", { requestId }, requestId)
        }

        abortSignal?.addEventListener("abort", onAbort, { once: true })

        const stream = createModelStream(requestId, () => {
          abortSignal?.removeEventListener("abort", onAbort)
        })

        try {
          await request("model-do-stream", {
            modelId: resolvedModelId,
            options: callOptions,
          }, requestId)
        } catch (error) {
          const handler = streamHandlers.get(requestId)
          handler?.fail(error)
          throw error
        }

        return { stream }
      },
    }
  }

  function onMessage(event: MessageEvent<unknown>) {
    if (event.source !== root) return
    const data = event.data
    if (!data || typeof data !== "object") return

    const message = data as BridgeMessage
    if (message.source !== target || typeof message.requestId !== "string") return

    if (message.type === "response") {
      const match = pending.get(message.requestId)
      if (!match) return

      pending.delete(message.requestId)
      root.clearTimeout(match.timeoutId)

      if (message.ok) {
        match.resolve(message.payload)
      } else {
        match.reject(new Error(message.error || "Bridge request failed"))
      }

      return
    }

    if (message.type === "stream") {
      const stream = streamHandlers.get(message.requestId)
      if (!stream) return

      if (!message.ok) {
        stream.fail(message.error || "Stream failed")
        return
      }

      const payload = message.payload
      if (!payload || typeof payload !== "object") return

      const streamMessage = payload as { type?: string; data?: unknown }
      if (streamMessage.type === "chunk") {
        stream.push(streamMessage.data)
        return
      }

      if (streamMessage.type === "done") {
        stream.finish()
      }
    }
  }

  root.addEventListener("message", onMessage)

  return {
    listModels() {
      return request<{ models?: BridgeModelSummary[] }>("list-models", {}).then((response) =>
        Array.isArray(response.models) ? response.models : [],
      )
    },
    async getModel(modelId) {
      if (typeof modelId !== "string" || modelId.length === 0) {
        throw new Error("modelId is required")
      }

      const descriptor = await request("get-model", { modelId })
      return createLanguageModel(modelId, descriptor)
    },
    getState() {
      return request("get-state", {})
    },
    requestPermission(payload = {}) {
      return request("request-permission", payload as Record<string, unknown>)
    },
    abort(requestId) {
      if (!requestId) return
      post("abort", { requestId }, requestId)
    },
    destroy() {
      root.removeEventListener("message", onMessage)
      for (const [requestId, match] of pending.entries()) {
        root.clearTimeout(match.timeoutId)
        match.reject(new Error(`Bridge client destroyed before response for ${requestId}`))
      }
      pending.clear()
      streamHandlers.clear()
    },
  }
}

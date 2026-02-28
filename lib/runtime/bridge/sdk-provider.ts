export type BridgeInvokeInput = {
  model: string
  body: Record<string, unknown>
  stream?: boolean
}

export type BridgeStreamHandle = {
  requestId: string
  [Symbol.asyncIterator](): AsyncIterator<string>
  cancel(): void
}

export type BridgeClient = {
  listModels(): Promise<{ models: Array<{ id: string; name: string; provider: string; capabilities: string[]; connected: boolean }> }>
  requestPermission(input: { modelId: string; provider?: string; modelName?: string; capabilities?: string[] }): Promise<unknown>
  invoke(input: BridgeInvokeInput): Promise<unknown | BridgeStreamHandle>
  abort(requestId: string): void
}

export type AISDKLikeModel = {
  modelId: string
  doGenerate(input: { messages: Array<Record<string, unknown>>; [key: string]: unknown }): Promise<unknown>
  doStream(input: { messages: Array<Record<string, unknown>>; [key: string]: unknown }): Promise<BridgeStreamHandle>
}

export type AISDKLikeProvider = {
  languageModel(modelId: string): AISDKLikeModel
  listModels(): Promise<{ models: Array<{ id: string; name: string; provider: string; capabilities: string[]; connected: boolean }> }>
  requestPermission(input: { modelId: string; provider?: string; modelName?: string; capabilities?: string[] }): Promise<unknown>
}

export function createLLMBridgeProvider(client: BridgeClient): AISDKLikeProvider {
  return {
    languageModel(modelId: string) {
      return {
        modelId,
        async doGenerate(input) {
          return client.invoke({
            model: modelId,
            body: {
              model: modelId,
              ...input,
            },
            stream: false,
          })
        },
        async doStream(input) {
          const handle = await client.invoke({
            model: modelId,
            body: {
              model: modelId,
              ...input,
              stream: true,
            },
            stream: true,
          })

          if (!handle || typeof handle !== "object" || !(Symbol.asyncIterator in handle)) {
            throw new Error("Expected stream handle from llmBridge.invoke")
          }

          return handle as BridgeStreamHandle
        },
      }
    },
    listModels() {
      return client.listModels()
    },
    requestPermission(input) {
      return client.requestPermission(input)
    },
  }
}

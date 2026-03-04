import {
  AuthFlowExpiredError,
  ModelNotFoundError,
  PAGE_BRIDGE_INIT_MESSAGE,
  PAGE_BRIDGE_READY_EVENT,
  PermissionDeniedError,
  PageBridgeRpcGroup,
  ProviderNotConnectedError,
  RuntimeValidationError,
  TransportProtocolError,
  type RuntimeRpcError,
  type PageBridgeRpc,
  type BridgeModelCallRequest,
} from "@llm-bridge/contracts"
import * as RpcServer from "@effect/rpc/RpcServer"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import { getRuntimeRPC } from "@/lib/runtime/rpc/runtime-rpc-client"
import { decodeClientMessage, encodeServerMessage } from "@/lib/rpc/rpc-wire"

const BRIDGE_TIMEOUT_MS = 30_000

function toRuntimeRpcError(error: unknown): RuntimeRpcError {
  if (
    error instanceof PermissionDeniedError
    || error instanceof ModelNotFoundError
    || error instanceof ProviderNotConnectedError
    || error instanceof AuthFlowExpiredError
    || error instanceof TransportProtocolError
    || error instanceof RuntimeValidationError
  ) {
    return error
  }

  return new RuntimeValidationError({
    message: error instanceof Error ? error.message : String(error),
  })
}

function fromPromise<A>(run: () => Promise<A>) {
  return Effect.tryPromise({
    try: run,
    catch: toRuntimeRpcError,
  })
}

function nextBridgeRequestId() {
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

function parseProviderModel(modelId: string) {
  const [providerID, ...rest] = modelId.split("/")
  return {
    providerID,
    modelID: rest.join("/"),
  }
}

function normalizeModelCallInput(input: BridgeModelCallRequest) {
  const requestId =
    typeof input.requestId === "string" && input.requestId.length > 0
      ? input.requestId
      : nextBridgeRequestId()

  const sessionID =
    typeof input.sessionID === "string" && input.sessionID.length > 0
      ? input.sessionID
      : requestId

  return {
    requestId,
    sessionID,
    modelId: input.modelId,
    options: input.options ?? {},
  }
}

function createPageBridgeHandlers() {
  const runtime = getRuntimeRPC()

  return PageBridgeRpcGroup.of({
    getState: () =>
      fromPromise(async () => {
        const currentOrigin = window.location.origin

        const [providersData, modelsData, permissionsData, pendingData, originData] = await Promise.all([
          runtime.listProviders({ origin: currentOrigin }),
          runtime.listModels({ origin: currentOrigin }),
          runtime.listPermissions({ origin: currentOrigin }),
          runtime.listPending({ origin: currentOrigin }),
          runtime.getOriginState({ origin: currentOrigin }),
        ])

        const modelsByProvider = new Map<
          string,
          Array<{ id: string; name: string; capabilities: ReadonlyArray<string> }>
        >()

        for (const model of modelsData) {
          const existing = modelsByProvider.get(model.provider) ?? []
          existing.push({
            id: model.id,
            name: model.name,
            capabilities: model.capabilities,
          })
          modelsByProvider.set(model.provider, existing)
        }

        return {
          providers: providersData.map((provider) => ({
            id: provider.id,
            name: provider.name,
            connected: provider.connected,
            env: provider.env,
            authMethods: [],
            models: modelsByProvider.get(provider.id) ?? [],
          })),
          permissions: permissionsData,
          pendingRequests: pendingData,
          originEnabled: originData.enabled,
          currentOrigin,
        }
      }),

    listModels: () =>
      fromPromise(async () => {
        const models = await runtime.listModels({
          origin: window.location.origin,
          connectedOnly: true,
        })

        return {
          models,
        }
      }),

    getModel: (input) =>
      fromPromise(async () => {
        const modelId = input.modelId
        if (!modelId) {
          throw new Error("Model is required for getModel")
        }

        const requestId =
          typeof input.requestId === "string" && input.requestId.length > 0
            ? input.requestId
            : nextBridgeRequestId()

        const sessionID =
          typeof input.sessionID === "string" && input.sessionID.length > 0
            ? input.sessionID
            : requestId

        const descriptor = await runtime.acquireModel({
          origin: window.location.origin,
          requestId,
          sessionID,
          modelId,
        })

        return descriptor
      }),

    requestPermission: (input) =>
      fromPromise(async () => {
        const modelId = input.modelId ?? "openai/gpt-4o-mini"
        const parsed = parseProviderModel(modelId)

        return runtime.requestPermission({
          action: "create",
          origin: window.location.origin,
          modelId,
          modelName: input.modelName ?? parsed.modelID,
          provider: input.provider ?? parsed.providerID,
          capabilities: input.capabilities,
        })
      }),

    abort: (input) =>
      fromPromise(async () => {
        if (!input.requestId) {
          return { ok: true }
        }

        await runtime.abortModelCall({
          requestId: input.requestId,
        })

        return {
          ok: true,
        }
      }),

    modelDoGenerate: (input) =>
      fromPromise(async () => {
        const normalized = normalizeModelCallInput(input)
        return runtime.modelDoGenerate({
          origin: window.location.origin,
          requestId: normalized.requestId,
          sessionID: normalized.sessionID,
          modelId: normalized.modelId,
          options: normalized.options,
        })
      }),

    modelDoStream: (input) => {
      const normalized = normalizeModelCallInput(input)

      return Stream.fromAsyncIterable(
        {
          [Symbol.asyncIterator]: async function* () {
            const iterable = runtime.modelDoStream({
              origin: window.location.origin,
              requestId: normalized.requestId,
              sessionID: normalized.sessionID,
              modelId: normalized.modelId,
              options: normalized.options,
            })

            for await (const chunk of iterable) {
              yield chunk
            }
          },
        },
        toRuntimeRpcError,
      )
    },
  })
}

async function attachServerToPort(port: MessagePort) {
  const scope = await Effect.runPromise(Scope.make())

  const handlersLayer = PageBridgeRpcGroup.toLayer(Effect.succeed(createPageBridgeHandlers()))

  const server = await Effect.runPromise(
    RpcServer.makeNoSerialization(PageBridgeRpcGroup, {
      onFromServer: (message) =>
        Effect.sync(() => {
          port.postMessage(encodeServerMessage(message))
        }),
      disableTracing: true,
      concurrency: "unbounded",
    }).pipe(
      Effect.provide(handlersLayer),
      Scope.extend(scope),
    ),
  )

  const onMessage = (event: MessageEvent<unknown>) => {
    const decoded = decodeClientMessage<PageBridgeRpc>(event.data)
    if (!decoded) return

    void Effect.runPromise(
      Effect.timeout(
        server.write(0, decoded),
        BRIDGE_TIMEOUT_MS,
      ),
    ).catch((error) => {
      console.warn("page bridge rpc write failed", error)
    })
  }

  port.addEventListener("message", onMessage)
  port.start()

  port.addEventListener("messageerror", (error) => {
    console.warn("page bridge rpc message error", error)
  })

  const cleanup = async () => {
    port.removeEventListener("message", onMessage)
    await Effect.runPromise(Scope.close(scope, Exit.succeed(undefined)))
  }

  return cleanup
}

export function setupPageApiBridge() {
  const onMessage = async (event: MessageEvent) => {
    if (event.source !== window || event.data?.type !== PAGE_BRIDGE_INIT_MESSAGE || !event.ports[0]) {
      return
    }

    const port = event.ports[0]
    window.removeEventListener("message", onMessage)

    try {
      await attachServerToPort(port)
    } catch (error) {
      console.warn("failed to initialize page bridge rpc", error)
    }
  }

  window.addEventListener("message", onMessage)

  document.documentElement.dataset.llmBridgeReady = "true"
  window.dispatchEvent(new CustomEvent(PAGE_BRIDGE_READY_EVENT))
}

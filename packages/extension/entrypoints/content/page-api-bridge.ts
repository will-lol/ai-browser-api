import {
  PAGE_BRIDGE_INIT_MESSAGE,
  PAGE_BRIDGE_READY_EVENT,
  PageBridgeRpcGroup,
  RuntimeValidationError,
  isPageBridgePortControlMessage,
  toRuntimeRpcError,
  type BridgeModelCallRequest,
  type PageBridgePortControlMessage,
} from "@llm-bridge/contracts"
import * as RpcServer from "@effect/rpc/RpcServer"
import type { FromClientEncoded, FromServerEncoded } from "@effect/rpc/RpcMessage"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Mailbox from "effect/Mailbox"
import * as Option from "effect/Option"
import * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import { getRuntimePublicRPC } from "@/lib/runtime/rpc/runtime-public-rpc-client"
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
  const requestId = input.requestId ?? nextBridgeRequestId()
  const sessionID = input.sessionID ?? requestId

  return {
    requestId,
    sessionID,
    modelId: input.modelId,
    options: input.options,
  }
}

function createPageBridgeHandlers() {
  const runtime = getRuntimePublicRPC()

  return PageBridgeRpcGroup.of({
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
        const requestId = input.requestId ?? nextBridgeRequestId()
        const sessionID = input.sessionID ?? requestId

        const descriptor = await runtime.acquireModel({
          origin: window.location.origin,
          requestId,
          sessionID,
          modelId: input.modelId,
        })

        return descriptor
      }),

    requestPermission: (input) =>
      fromPromise(async () => {
        const modelId = input.modelId ?? "openai/gpt-4o-mini"
        const parsed = parseProviderModel(modelId)
        const result = await runtime.requestPermission({
          action: "create",
          origin: window.location.origin,
          modelId,
          modelName: input.modelName ?? parsed.modelID,
          provider: input.provider ?? parsed.providerID,
          capabilities: input.capabilities,
        })

        if (!("status" in result)) {
          throw new RuntimeValidationError({
            message: "Unexpected permission response shape",
          })
        }

        return result
      }),

    abort: (input) =>
      fromPromise(async () => {
        if (!input.requestId) {
          return { ok: true }
        }

        const sessionID = input.sessionID ?? input.requestId

        await runtime.abortModelCall({
          origin: window.location.origin,
          sessionID,
          requestId: input.requestId,
        })

        return {
          ok: true,
        }
      }),

    modelDoGenerate: (input) =>
      fromPromise(async () => {
        const normalized = normalizeModelCallInput(input)
        if (!normalized.options) {
          throw new RuntimeValidationError({
            message: "modelDoGenerate requires call options with prompt",
          })
        }
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
      const options = normalized.options
      if (!options) {
        return Stream.fail(
          new RuntimeValidationError({
            message: "modelDoStream requires call options with prompt",
          }),
        )
      }

      return Stream.fromAsyncIterable(
        {
          [Symbol.asyncIterator]: async function* () {
            const iterable = runtime.modelDoStream({
              origin: window.location.origin,
              requestId: normalized.requestId,
              sessionID: normalized.sessionID,
              modelId: normalized.modelId,
              options,
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

type PageBridgeSession = {
  readonly id: number
  readonly port: MessagePort
  readonly cleanup: (reason: string) => Promise<void>
}

async function attachServerToPort(
  sessionId: number,
  port: MessagePort,
  sessions: Map<MessagePort, PageBridgeSession>,
) {
  const scope = await Effect.runPromise(Scope.make())
  let disposed = false
  let onMessage: ((event: MessageEvent<FromClientEncoded | PageBridgePortControlMessage>) => void) | null = null
  let onMessageError: ((event: MessageEvent<unknown>) => void) | null = null

  const cleanup = async (_reason: string) => {
    if (disposed) return
    disposed = true

    if (onMessage) {
      port.removeEventListener("message", onMessage)
    }

    if (onMessageError) {
      port.removeEventListener("messageerror", onMessageError)
    }

    const existing = sessions.get(port)
    if (existing?.id === sessionId) {
      sessions.delete(port)
    }

    await Effect.runPromise(Scope.close(scope, Exit.succeed(undefined))).catch(() => undefined)

    try {
      port.close()
    } catch {
      // ignored
    }
  }

  const handlersLayer = PageBridgeRpcGroup.toLayer(Effect.succeed(createPageBridgeHandlers()))

  const protocol = await Effect.runPromise(
    RpcServer.Protocol.make((writeRequest) =>
      Effect.gen(function*() {
        const disconnects = yield* Mailbox.make<number>()
        const clientIds = new Set<number>([0])

        onMessage = (
          event: MessageEvent<FromClientEncoded | PageBridgePortControlMessage>,
        ) => {
          if (isPageBridgePortControlMessage(event.data)) {
            if (event.data.type === "disconnect") {
              void cleanup('control-disconnect')
            }

            return
          }

          void Effect.runPromise(writeRequest(0, event.data)).catch((error) => {
            console.warn("page bridge rpc write failed", error)
          })
        }

        onMessageError = (_event: MessageEvent<unknown>) => {
          void Effect.runPromise(disconnects.offer(0)).catch(() => undefined)
          void cleanup('messageerror')
        }

        port.addEventListener("message", onMessage)
        port.addEventListener("messageerror", onMessageError)
        port.start()

        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            if (onMessage) {
              port.removeEventListener("message", onMessage)
            }

            if (onMessageError) {
              port.removeEventListener("messageerror", onMessageError)
            }
          }),
        )

        return {
          disconnects,
          send: (_clientId: number, message: FromServerEncoded) =>
            Effect.sync(() => {
              try {
                port.postMessage(message)
              } catch (_error) {
                void cleanup('postMessage-failed')
              }
            }),
          end: (_clientId: number) => Effect.void,
          clientIds: Effect.sync(() => new Set(clientIds)),
          initialMessage: Effect.succeed(Option.none()),
          supportsAck: true,
          supportsTransferables: false,
          supportsSpanPropagation: true,
        } as const
      }),
    ).pipe(Scope.extend(scope)),
  )

  await Effect.runPromise(
    RpcServer.make(PageBridgeRpcGroup, {
      disableTracing: true,
      concurrency: "unbounded",
    }).pipe(
      Effect.provide(handlersLayer),
      Effect.provideService(RpcServer.Protocol, protocol),
      Effect.forkScoped,
      Scope.extend(scope),
    ),
  )

  return cleanup
}

export function setupPageApiBridge() {
  const sessions = new Map<MessagePort, PageBridgeSession>()
  let nextSessionId = 0

  const cleanupAllSessions = async (reason: string) => {
    const activeSessions = [...sessions.values()]

    await Promise.all(activeSessions.map((session) => session.cleanup(reason)))
  }

  const onMessage = async (event: MessageEvent) => {
    // `event.source` is only used as a local filter; authorization is enforced in background RPC.
    if (event.source !== window || event.data?.type !== PAGE_BRIDGE_INIT_MESSAGE || !event.ports[0]) {
      return
    }

    const port = event.ports[0]
    if (sessions.has(port)) {
      return
    }

    const sessionId = ++nextSessionId

    try {
      const cleanup = await attachServerToPort(sessionId, port, sessions)
      sessions.set(port, {
        id: sessionId,
        port,
        cleanup,
      })
    } catch (error) {
      console.warn("failed to initialize page bridge rpc", error)
    }
  }

  window.addEventListener("message", onMessage)
  window.addEventListener(
    "pagehide",
    () => {
      void cleanupAllSessions('pagehide')
    },
    { once: true },
  )

  document.documentElement.dataset.llmBridgeReady = "true"
  window.dispatchEvent(new CustomEvent(PAGE_BRIDGE_READY_EVENT))
}

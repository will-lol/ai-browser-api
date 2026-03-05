import {
  AuthFlowExpiredError,
  ModelNotFoundError,
  PAGE_BRIDGE_INIT_MESSAGE,
  PAGE_BRIDGE_PORT_CONTROL_MESSAGE,
  PAGE_BRIDGE_READY_EVENT,
  PermissionDeniedError,
  PageBridgeRpcGroup,
  ProviderNotConnectedError,
  RuntimeValidationError,
  TransportProtocolError,
  isPageBridgePortControlMessage,
  type RuntimeRpcError,
  type PageBridgeRpc,
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
import { getRuntimeRPC } from "@/lib/runtime/rpc/runtime-rpc-client"
const PAGE_BRIDGE_LOG_PREFIX = '[page-bridge-content]'

function toLogString(meta: unknown) {
  if (meta === undefined) return ''
  if (typeof meta === 'string') return meta

  try {
    return JSON.stringify(meta, (_key, value) => (typeof value === 'bigint' ? value.toString() : value))
  } catch {
    return String(meta)
  }
}

function bridgeLog(event: string, meta?: unknown) {
  console.info(PAGE_BRIDGE_LOG_PREFIX, new Date().toISOString(), event, toLogString(meta))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function summarizeRpcMessage(message: unknown) {
  if (!isRecord(message)) {
    return { type: typeof message }
  }

  const summary: Record<string, unknown> = {}
  for (const key of ['_id', '_tag', 'id', 'requestId', 'tag', 'method', 'clientId']) {
    if (key in message) {
      summary[key] = message[key]
    }
  }

  if ('payload' in message && isRecord(message.payload)) {
    summary.payloadKeys = Object.keys(message.payload)
  }

  if ('values' in message && Array.isArray(message.values)) {
    summary.valuesLength = message.values.length
  }

  if ('exit' in message && isRecord(message.exit) && '_tag' in message.exit) {
    summary.exitTag = message.exit._tag
  }

  return summary
}

function summarizeValue(value: unknown) {
  if (Array.isArray(value)) {
    return { type: 'array', length: value.length }
  }

  if (isRecord(value)) {
    return { type: 'object', keys: Object.keys(value) }
  }

  return { type: typeof value, value }
}

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

function fromPromise<A>(operation: string, run: () => Promise<A>) {
  return Effect.tryPromise({
    try: async () => {
      bridgeLog(`${operation}.start`)
      const value = await run()
      bridgeLog(`${operation}.success`, summarizeValue(value))
      return value
    },
    catch: (error) => {
      bridgeLog(`${operation}.failure`, {
        message: error instanceof Error ? error.message : String(error),
      })
      return toRuntimeRpcError(error)
    },
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
  const runtime = getRuntimeRPC()

  return PageBridgeRpcGroup.of({
    getState: () =>
      fromPromise('getState', async () => {
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
      fromPromise('listModels', async () => {
        const models = await runtime.listModels({
          origin: window.location.origin,
          connectedOnly: true,
        })

        return {
          models,
        }
      }),

    getModel: (input) =>
      fromPromise('getModel', async () => {
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
      fromPromise('requestPermission', async () => {
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
      fromPromise('abort', async () => {
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
      fromPromise('modelDoGenerate', async () => {
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
      bridgeLog('modelDoStream.start', {
        requestId: normalized.requestId,
        modelId: normalized.modelId,
      })
      if (!options) {
        bridgeLog('modelDoStream.invalidOptions', {
          requestId: normalized.requestId,
          modelId: normalized.modelId,
        })
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
              bridgeLog('modelDoStream.chunk', summarizeValue(chunk))
              yield chunk
            }

            bridgeLog('modelDoStream.complete', {
              requestId: normalized.requestId,
              modelId: normalized.modelId,
            })
          },
        },
        (error) => {
          bridgeLog('modelDoStream.failure', {
            requestId: normalized.requestId,
            modelId: normalized.modelId,
            message: error instanceof Error ? error.message : String(error),
          })
          return toRuntimeRpcError(error)
        },
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
  bridgeLog('attachServerToPort.start', { sessionId })
  const scope = await Effect.runPromise(Scope.make())
  let disposed = false
  let onMessage: ((event: MessageEvent<FromClientEncoded | PageBridgePortControlMessage>) => void) | null = null
  let onMessageError: ((event: MessageEvent<unknown>) => void) | null = null

  const cleanup = async (reason: string) => {
    if (disposed) return
    disposed = true
    bridgeLog('session.cleanup.start', { sessionId, reason })

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

    bridgeLog('session.cleanup.complete', {
      sessionId,
      reason,
      activeSessions: sessions.size,
    })
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
            bridgeLog('port.control.inbound', {
              sessionId,
              controlTag: PAGE_BRIDGE_PORT_CONTROL_MESSAGE,
              type: event.data.type,
              reason: event.data.reason,
              connectionId: event.data.connectionId,
            })

            if (event.data.type === "disconnect") {
              void cleanup('control-disconnect')
            }

            return
          }

          bridgeLog('rpc.inbound', {
            sessionId,
            message: summarizeRpcMessage(event.data),
          })

          void Effect.runPromise(writeRequest(0, event.data)).catch((error) => {
            bridgeLog('rpc.write.failed', {
              sessionId,
              message: error instanceof Error ? error.message : String(error),
            })
            console.warn("page bridge rpc write failed", error)
          })
        }

        onMessageError = (event: MessageEvent<unknown>) => {
          bridgeLog('port.messageerror', {
            sessionId,
            data: summarizeValue(event.data),
          })
          void Effect.runPromise(disconnects.offer(0)).catch(() => undefined)
          void cleanup('messageerror')
        }

        port.addEventListener("message", onMessage)
        port.addEventListener("messageerror", onMessageError)
        port.start()
        bridgeLog('port.started', { sessionId })

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
              bridgeLog('rpc.outbound', {
                sessionId,
                message: summarizeRpcMessage(message),
              })

              try {
                port.postMessage(message)
              } catch (error) {
                bridgeLog('rpc.outbound.postMessageFailed', {
                  sessionId,
                  message: error instanceof Error ? error.message : String(error),
                })
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

  bridgeLog('attachServerToPort.ready', { sessionId })
  return cleanup
}

export function setupPageApiBridge() {
  const sessions = new Map<MessagePort, PageBridgeSession>()
  let nextSessionId = 0

  const cleanupAllSessions = async (reason: string) => {
    const activeSessions = [...sessions.values()]
    bridgeLog('sessions.cleanupAll.start', {
      reason,
      count: activeSessions.length,
    })

    await Promise.all(activeSessions.map((session) => session.cleanup(reason)))

    bridgeLog('sessions.cleanupAll.complete', {
      reason,
      count: sessions.size,
    })
  }

  const onMessage = async (event: MessageEvent) => {
    if (event.data?.type === PAGE_BRIDGE_INIT_MESSAGE) {
      bridgeLog('window.init.received', {
        sourceIsWindow: event.source === window,
        ports: event.ports.length,
        origin: event.origin,
      })
    }

    if (event.source !== window || event.data?.type !== PAGE_BRIDGE_INIT_MESSAGE || !event.ports[0]) {
      return
    }

    const port = event.ports[0]
    if (sessions.has(port)) {
      bridgeLog('window.init.duplicatePort', {
        sessionId: sessions.get(port)?.id,
      })
      return
    }

    const sessionId = ++nextSessionId
    bridgeLog('window.init.accepted', {
      sessionId,
    })

    try {
      const cleanup = await attachServerToPort(sessionId, port, sessions)
      sessions.set(port, {
        id: sessionId,
        port,
        cleanup,
      })
      bridgeLog('window.init.attached', {
        sessionId,
        activeSessions: sessions.size,
      })
    } catch (error) {
      bridgeLog('window.init.attachFailed', {
        sessionId,
        message: error instanceof Error ? error.message : String(error),
      })
      console.warn("failed to initialize page bridge rpc", error)
    }
  }

  window.addEventListener("message", onMessage)
  bridgeLog('bridge.listener.installed')
  window.addEventListener(
    "pagehide",
    () => {
      bridgeLog('bridge.pagehide')
      void cleanupAllSessions('pagehide')
    },
    { once: true },
  )

  document.documentElement.dataset.llmBridgeReady = "true"
  window.dispatchEvent(new CustomEvent(PAGE_BRIDGE_READY_EVENT))
  bridgeLog('bridge.ready.dispatched')
}

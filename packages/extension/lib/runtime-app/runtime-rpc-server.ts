import { browser } from "@wxt-dev/browser"
import type * as Rpc from "@effect/rpc/Rpc"
import * as RpcServer from "@effect/rpc/RpcServer"
import type * as Layer from "effect/Layer"
import * as Effect from "effect/Effect"
import * as Scope from "effect/Scope"
import * as Exit from "effect/Exit"
import { RUNTIME_RPC_PORT_NAME, RuntimeRpcGroup, type RuntimeRpc } from "@llm-bridge/contracts"
import { decodeClientMessage, encodeServerMessage } from "@/lib/rpc/rpc-wire"

type RuntimePort = ReturnType<typeof browser.runtime.connect>

export async function registerRuntimeRpcServer<E>(
  layer: Layer.Layer<Rpc.ToHandler<RuntimeRpc> | Rpc.Middleware<RuntimeRpc>, E, never>,
) {
  const scope = await Effect.runPromise(Scope.make())

  const ports = new Map<number, RuntimePort>()
  let nextClientId = 0

  const server = await Effect.runPromise(
    RpcServer.makeNoSerialization(RuntimeRpcGroup, {
      onFromServer: (message) =>
        Effect.sync(() => {
          const port = ports.get(message.clientId)
          if (!port) return

          try {
            port.postMessage(encodeServerMessage(message))
          } catch (error) {
            console.warn("runtime rpc postMessage failed", error)
          }
        }),
      disableTracing: true,
    }).pipe(
      Effect.provide(layer),
      Scope.extend(scope),
    ),
  )

  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== RUNTIME_RPC_PORT_NAME) return

    const clientId = ++nextClientId
    ports.set(clientId, port)

    const onMessage: Parameters<typeof port.onMessage.addListener>[0] = (payload) => {
      const decoded = decodeClientMessage<RuntimeRpc>(payload)
      if (!decoded) {
        console.warn("runtime rpc: invalid client message", payload)
        return
      }

      void Effect.runPromise(server.write(clientId, decoded)).catch((error) => {
        console.warn("runtime rpc write failed", error)
      })
    }

    const onDisconnect: Parameters<typeof port.onDisconnect.addListener>[0] = () => {
      ports.delete(clientId)
      port.onMessage.removeListener(onMessage)
      void Effect.runPromise(server.disconnect(clientId)).catch((error) => {
        console.warn("runtime rpc disconnect failed", error)
      })
    }

    port.onMessage.addListener(onMessage)
    port.onDisconnect.addListener(onDisconnect)
  })

  return () =>
    Effect.runPromise(
      Scope.close(scope, Exit.succeed(undefined)),
    )
}

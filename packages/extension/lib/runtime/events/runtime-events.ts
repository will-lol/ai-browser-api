import { RuntimeEventPayloadSchema, type RuntimeEventPayload } from "@/lib/runtime/events/runtime-event-defs"

export const RUNTIME_EVENT_CHANNEL_NAME = "llm-bridge-runtime-events-v1"

let runtimeChannel: BroadcastChannel | null = null
const localListeners = new Set<(event: RuntimeEventPayload) => void>()

function getRuntimeChannel() {
  if (typeof BroadcastChannel === "undefined") return null

  if (!runtimeChannel) {
    runtimeChannel = new BroadcastChannel(RUNTIME_EVENT_CHANNEL_NAME)
  }

  return runtimeChannel
}

export function publishRuntimeEvent(event: RuntimeEventPayload) {
  const parsed = RuntimeEventPayloadSchema.parse(event)
  for (const listener of localListeners) {
    try {
      listener(parsed)
    } catch (error) {
      console.warn("runtime event listener failed", error)
    }
  }
  const channel = getRuntimeChannel()
  channel?.postMessage(parsed)
}

export function subscribeRuntimeEvents(
  handler: (event: RuntimeEventPayload) => void,
) {
  localListeners.add(handler)

  const channel = getRuntimeChannel()
  if (!channel) {
    return () => {
      localListeners.delete(handler)
    }
  }

  const listener = (input: MessageEvent<unknown>) => {
    const parsed = RuntimeEventPayloadSchema.safeParse(input.data)
    if (!parsed.success) return
    handler(parsed.data)
  }

  channel.addEventListener("message", listener)

  return () => {
    localListeners.delete(handler)
    channel.removeEventListener("message", listener)
  }
}

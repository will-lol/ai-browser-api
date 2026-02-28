import { RuntimeEventPayloadSchema, type RuntimeEventPayload } from "@/lib/runtime/events/runtime-event-defs"

export const RUNTIME_EVENT_CHANNEL_NAME = "llm-bridge-runtime-events-v1"

let runtimeChannel: BroadcastChannel | null = null

function getRuntimeChannel() {
  if (typeof BroadcastChannel === "undefined") return null

  if (!runtimeChannel) {
    runtimeChannel = new BroadcastChannel(RUNTIME_EVENT_CHANNEL_NAME)
  }

  return runtimeChannel
}

export function publishRuntimeEvent(event: RuntimeEventPayload) {
  const parsed = RuntimeEventPayloadSchema.parse(event)
  const channel = getRuntimeChannel()
  channel?.postMessage(parsed)
}

export function subscribeRuntimeEvents(
  handler: (event: RuntimeEventPayload) => void,
) {
  const channel = getRuntimeChannel()
  if (!channel) {
    return () => {}
  }

  const listener = (input: MessageEvent<unknown>) => {
    const parsed = RuntimeEventPayloadSchema.safeParse(input.data)
    if (!parsed.success) return
    handler(parsed.data)
  }

  channel.addEventListener("message", listener)

  return () => {
    channel.removeEventListener("message", listener)
  }
}

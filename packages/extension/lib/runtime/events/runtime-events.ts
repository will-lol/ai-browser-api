import * as Either from "effect/Either"
import * as Schema from "effect/Schema"
import { RuntimeEventPayloadSchema, type RuntimeEventPayload } from "@/lib/runtime/events/runtime-event-defs"

export const RUNTIME_EVENT_CHANNEL_NAME = "llm-bridge-runtime-events-v1"

let runtimeChannel: BroadcastChannel | null = null
const localListeners = new Set<(event: RuntimeEventPayload) => void>()

const decodeRuntimeEvent = Schema.decodeUnknownEither(RuntimeEventPayloadSchema)

function parseEvent(input: unknown): RuntimeEventPayload | undefined {
  const parsed = decodeRuntimeEvent(input)
  if (Either.isLeft(parsed)) return undefined
  return parsed.right
}

function getRuntimeChannel() {
  if (typeof BroadcastChannel === "undefined") return null

  if (!runtimeChannel) {
    runtimeChannel = new BroadcastChannel(RUNTIME_EVENT_CHANNEL_NAME)
  }

  return runtimeChannel
}

export function publishRuntimeEvent(event: RuntimeEventPayload) {
  const parsed = parseEvent(event)
  if (!parsed) {
    throw new Error("Invalid runtime event payload")
  }

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
    const parsed = parseEvent(input.data)
    if (!parsed) return
    handler(parsed)
  }

  channel.addEventListener("message", listener)

  return () => {
    localListeners.delete(handler)
    channel.removeEventListener("message", listener)
  }
}

import { RuntimeEventSchema, type RuntimeEvent } from "@llm-bridge/contracts"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Either from "effect/Either"
import * as Layer from "effect/Layer"
import * as PubSub from "effect/PubSub"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"

export const RuntimeEventEnvelopeSchema = Schema.Struct({
  id: Schema.String,
  source: Schema.String,
  at: Schema.Number,
  event: RuntimeEventSchema,
})

export type RuntimeEventEnvelope = Schema.Schema.Type<typeof RuntimeEventEnvelopeSchema>

const decodeRuntimeEventEnvelope = Schema.decodeUnknownEither(
  RuntimeEventEnvelopeSchema,
)

function randomEnvelopeId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID()
  }

  return `evt_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

export function parseRuntimeEventEnvelope(
  input: unknown,
): RuntimeEventEnvelope | undefined {
  const parsed = decodeRuntimeEventEnvelope(input)
  if (Either.isLeft(parsed)) return undefined
  return parsed.right
}

export interface RuntimeEventTransportApi {
  readonly publishEnvelope: (
    envelope: RuntimeEventEnvelope,
  ) => Effect.Effect<void, never>
  readonly streamEnvelopes: Stream.Stream<RuntimeEventEnvelope, never>
}

export class RuntimeEventTransport extends Context.Tag(
  "@llm-bridge/runtime-events/RuntimeEventTransport",
)<RuntimeEventTransport, RuntimeEventTransportApi>() {}

export interface RuntimeEventBusApi {
  readonly publish: (event: RuntimeEvent) => Effect.Effect<void, never>
  readonly stream: Stream.Stream<RuntimeEvent, never>
}

export class RuntimeEventBus extends Context.Tag(
  "@llm-bridge/runtime-events/RuntimeEventBus",
)<RuntimeEventBus, RuntimeEventBusApi>() {}

export function makeRuntimeEventBusLayer(options: { source: string }) {
  return Layer.scoped(
    RuntimeEventBus,
    Effect.gen(function*() {
      const transport = yield* RuntimeEventTransport
      const pubsub = yield* PubSub.unbounded<RuntimeEvent>()
      const seenEnvelopeIds = new Set<string>()

      const emitEnvelope = (envelope: RuntimeEventEnvelope) =>
        Effect.gen(function*() {
          if (envelope.source === options.source) return
          if (seenEnvelopeIds.has(envelope.id)) return

          seenEnvelopeIds.add(envelope.id)
          yield* PubSub.publish(pubsub, envelope.event)
        })

      yield* transport.streamEnvelopes.pipe(
        Stream.runForEach(emitEnvelope),
        Effect.forkScoped,
      )

      const publish = (event: RuntimeEvent) =>
        Effect.gen(function*() {
          const envelope: RuntimeEventEnvelope = {
            id: randomEnvelopeId(),
            source: options.source,
            at: Date.now(),
            event,
          }

          seenEnvelopeIds.add(envelope.id)
          yield* PubSub.publish(pubsub, event)
          yield* transport.publishEnvelope(envelope)
        })

      return {
        publish,
        stream: Stream.fromPubSub(pubsub),
      } satisfies RuntimeEventBusApi
    }),
  )
}

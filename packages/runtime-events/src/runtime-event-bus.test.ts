import assert from "node:assert/strict"
import { describe, it } from "node:test"
import type { RuntimeEvent } from "@llm-bridge/contracts"
import * as Chunk from "effect/Chunk"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import {
  RuntimeEventBus,
  RuntimeEventTransport,
  makeRuntimeEventBusLayer,
  type RuntimeEventEnvelope,
} from "./runtime-event-bus"

function sampleEvent(origin = "https://example.test"): RuntimeEvent {
  return {
    type: "runtime.pending.changed",
    payload: {
      origin,
      requestIds: ["req_1"],
    },
  }
}

function createTestTransportHarness() {
  const subscribers = new Set<(envelope: RuntimeEventEnvelope) => void>()

  const emit = (envelope: RuntimeEventEnvelope) => {
    for (const subscriber of subscribers) {
      subscriber(envelope)
    }
  }

  const layer = Layer.succeed(RuntimeEventTransport, {
    publishEnvelope: (envelope: RuntimeEventEnvelope) =>
      Effect.sync(() => {
        emit(envelope)
      }),
    streamEnvelopes: Stream.asyncPush<RuntimeEventEnvelope>((output) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          const subscriber = (envelope: RuntimeEventEnvelope) => {
            output.single(envelope)
          }

          subscribers.add(subscriber)

          return () => {
            subscribers.delete(subscriber)
          }
        }),
        (cleanup) => Effect.sync(cleanup),
      ),
    ),
  })

  return {
    layer,
    emit,
  }
}

describe("RuntimeEventBus", () => {
  it("publishes local events to the stream", async () => {
    await Effect.runPromise(
      Effect.gen(function*() {
        const transport = createTestTransportHarness()

        const runtimeScope = yield* Scope.make()
        const runtimeContext = yield* Layer.buildWithScope(
          makeRuntimeEventBusLayer({ source: "bus-a" }).pipe(
            Layer.provideMerge(transport.layer),
          ),
          runtimeScope,
        )
        const bus = Context.get(runtimeContext, RuntimeEventBus)

        const eventFiber = yield* bus.stream.pipe(
          Stream.take(1),
          Stream.runCollect,
          Effect.fork,
        )

        yield* Effect.sleep("10 millis")
        yield* bus.publish(sampleEvent())

        const events = yield* Fiber.join(eventFiber)
        const values = Chunk.toReadonlyArray(events)
        assert.equal(values.length, 1)
        assert.deepEqual(values[0], sampleEvent())

        yield* Scope.close(runtimeScope, Exit.succeed(undefined))
      }),
    )
  })

  it("delivers envelopes across bus instances sharing a transport", async () => {
    await Effect.runPromise(
      Effect.gen(function*() {
        const transport = createTestTransportHarness()

        const scopeA = yield* Scope.make()
        const scopeB = yield* Scope.make()

        const contextA = yield* Layer.buildWithScope(
          makeRuntimeEventBusLayer({ source: "bus-a" }).pipe(
            Layer.provideMerge(transport.layer),
          ),
          scopeA,
        )
        const busA = Context.get(contextA, RuntimeEventBus)

        const contextB = yield* Layer.buildWithScope(
          makeRuntimeEventBusLayer({ source: "bus-b" }).pipe(
            Layer.provideMerge(transport.layer),
          ),
          scopeB,
        )
        const busB = Context.get(contextB, RuntimeEventBus)

        const eventFiber = yield* busB.stream.pipe(
          Stream.take(1),
          Stream.runCollect,
          Effect.fork,
        )

        yield* Effect.sleep("10 millis")
        yield* busA.publish(sampleEvent("https://remote.example"))

        const events = yield* Fiber.join(eventFiber)
        const values = Chunk.toReadonlyArray(events)
        assert.equal(values.length, 1)
        assert.deepEqual(values[0], sampleEvent("https://remote.example"))

        yield* Scope.close(scopeA, Exit.succeed(undefined))
        yield* Scope.close(scopeB, Exit.succeed(undefined))
      }),
    )
  })

  it("ignores same-source envelopes and allows repeated foreign ids", async () => {
    await Effect.runPromise(
      Effect.gen(function*() {
        const transport = createTestTransportHarness()

        const scopeB = yield* Scope.make()
        const contextB = yield* Layer.buildWithScope(
          makeRuntimeEventBusLayer({ source: "bus-b" }).pipe(
            Layer.provideMerge(transport.layer),
          ),
          scopeB,
        )
        const busB = Context.get(contextB, RuntimeEventBus)

        const eventFiber = yield* busB.stream.pipe(
          Stream.take(2),
          Stream.runCollect,
          Effect.fork,
        )

        const foreignEnvelope: RuntimeEventEnvelope = {
          id: "evt-duplicate",
          source: "bus-a",
          at: Date.now(),
          event: sampleEvent("https://dedupe.example"),
        }

        yield* Effect.sleep("10 millis")
        transport.emit({
          id: "evt-self",
          source: "bus-b",
          at: Date.now(),
          event: sampleEvent("https://self.example"),
        })
        transport.emit(foreignEnvelope)
        transport.emit(foreignEnvelope)

        const events = yield* Fiber.join(eventFiber)
        const values = Chunk.toReadonlyArray(events)
        assert.deepEqual(values, [
          sampleEvent("https://dedupe.example"),
          sampleEvent("https://dedupe.example"),
        ])

        yield* Scope.close(scopeB, Exit.succeed(undefined))
      }),
    )
  })
})

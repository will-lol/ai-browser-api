import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Ref from "effect/Ref";
import { makeResettableConnectionLifecycle } from "./bridge-connection-lifecycle";

describe("makeResettableConnectionLifecycle", () => {
  it("retries after a failed connect attempt", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const attempts = yield* Ref.make(0);

        const lifecycle = yield* makeResettableConnectionLifecycle<number, string>({
          create: Ref.updateAndGet(attempts, (value) => value + 1).pipe(
            Effect.flatMap((attempt) =>
              attempt === 1
                ? Effect.fail("transient-connect-failure")
                : Effect.succeed(42),
            ),
          ),
          close: () => Effect.void,
          invalidatedError: () => "invalidated",
        });

        const first = yield* Effect.either(lifecycle.ensure);
        const second = yield* Effect.either(lifecycle.ensure);

        assert.equal(first._tag, "Left");
        assert.equal(second._tag, "Right");
        if (second._tag === "Right") {
          assert.equal(second.right, 42);
        }

        const count = yield* Ref.get(attempts);
        assert.equal(count, 2);
      }),
    );
  });

  it("coalesces concurrent ensure callers to one connect attempt", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const attempts = yield* Ref.make(0);
        const started = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();

        const lifecycle = yield* makeResettableConnectionLifecycle<number, string>({
          create: Effect.gen(function* () {
            yield* Ref.update(attempts, (value) => value + 1);
            yield* Deferred.succeed(started, undefined);
            yield* Deferred.await(release);
            return 99;
          }),
          close: () => Effect.void,
          invalidatedError: () => "invalidated",
        });

        const fiberA = yield* Effect.fork(lifecycle.ensure);
        const fiberB = yield* Effect.fork(lifecycle.ensure);

        yield* Deferred.await(started);
        const count = yield* Ref.get(attempts);
        assert.equal(count, 1);

        yield* Deferred.succeed(release, undefined);

        const valueA = yield* Fiber.join(fiberA);
        const valueB = yield* Fiber.join(fiberB);
        assert.equal(valueA, 99);
        assert.equal(valueB, 99);
      }),
    );
  });

  it("destroy invalidates waiters and closes stale late success", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const attempts = yield* Ref.make(0);
        const started = yield* Deferred.make<void>();
        const releaseFirst = yield* Deferred.make<void>();
        const staleClosed = yield* Deferred.make<void>();
        const closeReasons = yield* Ref.make<ReadonlyArray<string>>([]);

        const lifecycle = yield* makeResettableConnectionLifecycle<number, string>({
          create: Ref.updateAndGet(attempts, (value) => value + 1).pipe(
            Effect.flatMap((attempt) => {
              if (attempt === 1) {
                return Effect.uninterruptible(
                  Effect.gen(function* () {
                    yield* Deferred.succeed(started, undefined);
                    yield* Deferred.await(releaseFirst);
                    return 11;
                  }),
                );
              }

              return Effect.succeed(22);
            }),
          ),
          close: (value, reason) =>
            Effect.gen(function* () {
              yield* Ref.update(closeReasons, (current) => [
                ...current,
                `${reason}:${value}`,
              ]);

              if (reason === "stale" && value === 11) {
                yield* Deferred.succeed(staleClosed, undefined);
              }
            }),
          invalidatedError: () => "invalidated-during-connect",
        });

        const waitingFiber = yield* Effect.fork(Effect.either(lifecycle.ensure));

        yield* Deferred.await(started);
        yield* lifecycle.destroy;

        const first = yield* Fiber.join(waitingFiber);
        assert.equal(first._tag, "Left");
        if (first._tag === "Left") {
          assert.equal(first.left, "invalidated-during-connect");
        }

        yield* Deferred.succeed(releaseFirst, undefined);
        yield* Deferred.await(staleClosed);

        const second = yield* lifecycle.ensure;
        assert.equal(second, 22);

        const count = yield* Ref.get(attempts);
        assert.equal(count, 2);

        const closed = yield* Ref.get(closeReasons);
        assert.deepEqual(closed, ["stale:11"]);
      }),
    );
  });
});

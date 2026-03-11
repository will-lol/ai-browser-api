import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Ref from "effect/Ref";
import * as SynchronizedRef from "effect/SynchronizedRef";

type ResettableConnectionLifecycleCloseReason<
  ExtraCloseReason extends string = never,
> = "destroy" | "stale" | ExtraCloseReason;

type LifecycleState<A, E> =
  | {
      readonly _tag: "Idle";
    }
  | {
      readonly _tag: "Connecting";
      readonly token: number;
      readonly deferred: Deferred.Deferred<A, E>;
      readonly fiber: Fiber.RuntimeFiber<void, never>;
    }
  | {
      readonly _tag: "Ready";
      readonly token: number;
      readonly value: A;
    };

const idleState: LifecycleState<never, never> = {
  _tag: "Idle",
};

type ResettableConnectionLifecycleOptions<
  A,
  E,
  ExtraCloseReason extends string = never,
> = {
  readonly create: (token: number) => Effect.Effect<A, E>;
  readonly close: (
    value: A,
    reason: ResettableConnectionLifecycleCloseReason<ExtraCloseReason>,
  ) => Effect.Effect<void, never>;
  readonly invalidatedError: () => E;
  readonly onCreate?: Effect.Effect<void, never>;
  readonly onAwait?: Effect.Effect<void, never>;
  readonly onReuse?: (value: A) => Effect.Effect<void, never>;
};

export type ResettableConnectionLifecycle<
  A,
  E,
  ExtraCloseReason extends string = never,
> = {
  readonly ensure: Effect.Effect<A, E>;
  readonly destroy: Effect.Effect<void, never>;
  readonly destroyIfCurrent: (
    token: number,
    reason: ExtraCloseReason,
  ) => Effect.Effect<void, never>;
};

export function makeResettableConnectionLifecycle<
  A,
  E,
  ExtraCloseReason extends string = never,
>(
  options: ResettableConnectionLifecycleOptions<A, E, ExtraCloseReason>,
): Effect.Effect<ResettableConnectionLifecycle<A, E, ExtraCloseReason>> {
  return Effect.gen(function* () {
    const tokenRef = yield* Ref.make(0);
    const stateRef = yield* SynchronizedRef.make<LifecycleState<A, E>>(
      idleState as LifecycleState<A, E>,
    );

    const onCreate = options.onCreate ?? Effect.void;
    const onAwait = options.onAwait ?? Effect.void;

    const invalidateConnecting = (
      state: Extract<LifecycleState<A, E>, { _tag: "Connecting" }>,
    ) =>
      Effect.gen(function* () {
        yield* Deferred.fail(state.deferred, options.invalidatedError());
        yield* Effect.forkDaemon(
          Effect.sleep("1 millis").pipe(
            Effect.zipRight(Fiber.interrupt(state.fiber).pipe(Effect.asVoid)),
          ),
        );
      });

    const connectAttempt = (
      token: number,
      deferred: Deferred.Deferred<A, E>,
    ): Effect.Effect<void, never> =>
      Effect.uninterruptibleMask((restore) =>
        Effect.matchCauseEffect(restore(options.create(token)), {
          onFailure: (cause) =>
            SynchronizedRef.modifyEffect(stateRef, (state) => {
              if (state._tag === "Connecting" && state.token === token) {
                return Effect.gen(function* () {
                  yield* Deferred.failCause(deferred, cause);
                  return [undefined, idleState as LifecycleState<A, E>] as const;
                });
              }

              return Effect.succeed([undefined, state] as const);
            }),
          onSuccess: (value) =>
            Effect.gen(function* () {
              const stale = yield* SynchronizedRef.modifyEffect(
                stateRef,
                (state) => {
                  if (state._tag === "Connecting" && state.token === token) {
                    return Effect.gen(function* () {
                      yield* Deferred.succeed(deferred, value);
                      return [
                        false,
                        { _tag: "Ready", token, value } as LifecycleState<A, E>,
                      ] as const;
                    });
                  }

                  return Effect.succeed([true, state] as const);
                },
              );

              if (stale) {
                yield* options.close(value, "stale");
              }
            }),
        }),
      );

    const ensure: Effect.Effect<A, E> = Effect.flatten(
      SynchronizedRef.modifyEffect(stateRef, (state) => {
        switch (state._tag) {
          case "Idle":
            return Effect.gen(function* () {
              const token = yield* Ref.updateAndGet(
                tokenRef,
                (value) => value + 1,
              );
              const deferred = yield* Deferred.make<A, E>();
              const fiber = yield* Effect.forkDaemon(
                connectAttempt(token, deferred),
              );

              return [
                Effect.zipRight(onCreate, Deferred.await(deferred)),
                {
                  _tag: "Connecting",
                  token,
                  deferred,
                  fiber,
                } as LifecycleState<A, E>,
              ] as const;
            });
          case "Connecting":
            return Effect.succeed([
              Effect.zipRight(onAwait, Deferred.await(state.deferred)),
              state,
            ] as const);
          case "Ready": {
            const onReuse = options.onReuse?.(state.value) ?? Effect.void;
            return Effect.succeed([
              Effect.zipRight(onReuse, Effect.succeed(state.value)),
              state,
            ] as const);
          }
        }
      }),
    );

    const destroy = Effect.flatMap(
      SynchronizedRef.modifyEffect(stateRef, (state) => {
        switch (state._tag) {
          case "Idle":
            return Effect.succeed([
              Effect.void,
              idleState as LifecycleState<A, E>,
            ] as const);
          case "Ready":
            return Effect.succeed([
              options.close(state.value, "destroy"),
              idleState as LifecycleState<A, E>,
            ] as const);
          case "Connecting":
            return Effect.succeed([
              invalidateConnecting(state),
              idleState as LifecycleState<A, E>,
            ] as const);
        }
      }),
      (cleanup) => cleanup,
    );

    const destroyIfCurrent = (token: number, reason: ExtraCloseReason) =>
      Effect.flatMap(
        SynchronizedRef.modifyEffect(stateRef, (state) => {
          switch (state._tag) {
            case "Idle":
              return Effect.succeed([Effect.void, state] as const);
            case "Ready":
              if (state.token !== token) {
                return Effect.succeed([Effect.void, state] as const);
              }

              return Effect.succeed([
                options.close(state.value, reason),
                idleState as LifecycleState<A, E>,
              ] as const);
            case "Connecting":
              if (state.token !== token) {
                return Effect.succeed([Effect.void, state] as const);
              }

              return Effect.succeed([
                invalidateConnecting(state),
                idleState as LifecycleState<A, E>,
              ] as const);
          }
        }),
        (cleanup) => cleanup,
      );

    return {
      ensure,
      destroy,
      destroyIfCurrent,
    };
  });
}

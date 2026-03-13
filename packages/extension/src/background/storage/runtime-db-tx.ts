import Dexie, { type Table } from "dexie";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import { runtimeDb } from "@/background/storage/runtime-db";

type TxMode = "r" | "rw";
type AfterCommitEffect = Effect.Effect<void, unknown, never>;
type TxContextApi = {
  readonly registerAfterCommit: (effect: AfterCommitEffect) => void;
};

const RuntimeDbTxContext = Context.GenericTag<TxContextApi>(
  "@llm-bridge/extension/RuntimeDbTxContext",
);

const txBodyFailureSymbol = Symbol("@llm-bridge/runtime-db-tx/body-failure");

type TxBodyFailure = {
  readonly [txBodyFailureSymbol]: typeof txBodyFailureSymbol;
  readonly cause: Cause.Cause<unknown>;
};

function txBodyFailure(cause: Cause.Cause<unknown>): TxBodyFailure {
  return {
    [txBodyFailureSymbol]: txBodyFailureSymbol,
    cause,
  };
}

function isTxBodyFailure(error: unknown): error is TxBodyFailure {
  return (
    typeof error === "object" &&
    error !== null &&
    txBodyFailureSymbol in error &&
    "cause" in error
  );
}

function drainAfterCommitEffects(effects: ReadonlyArray<AfterCommitEffect>) {
  return Effect.forEach(
    effects,
    (effect) =>
      Effect.matchCauseEffect(effect, {
        onFailure: (cause) =>
          Effect.sync(() => {
            console.warn(
              "runTx afterCommit effect failed",
              Cause.squash(cause),
            );
          }),
        onSuccess: () => Effect.void,
      }),
    { discard: true },
  );
}

export function afterCommit<R>(
  effect: Effect.Effect<void, unknown, R>,
): Effect.Effect<void, never, R> {
  return Effect.gen(function* () {
    const capturedContext = yield* Effect.context<R>();
    const maybeTxContext = yield* Effect.serviceOption(RuntimeDbTxContext);

    if (Option.isNone(maybeTxContext)) {
      return yield* Effect.die(
        new Error("afterCommit must be called inside runTx"),
      );
    }

    maybeTxContext.value.registerAfterCommit(
      Effect.provide(effect, capturedContext),
    );
  });
}

export function runTx<T, E, R>(
  mode: TxMode,
  tables: Array<Table>,
  fn: () => Effect.Effect<T, E, R>,
): Effect.Effect<T, E | unknown, R>;
export function runTx<T, E, R>(
  tables: Array<Table>,
  fn: () => Effect.Effect<T, E, R>,
): Effect.Effect<T, E | unknown, R>;
export function runTx<T, E, R>(
  modeOrTables: TxMode | Array<Table>,
  maybeTablesOrFn:
    | Array<Table>
    | (() => Effect.Effect<T, E, R>),
  maybeFn?: () => Effect.Effect<T, E, R>,
): Effect.Effect<T, E | unknown, R> {
  const mode: TxMode = Array.isArray(modeOrTables) ? "rw" : modeOrTables;
  const tables = Array.isArray(modeOrTables) ? modeOrTables : maybeTablesOrFn;
  const fn = Array.isArray(modeOrTables) ? maybeTablesOrFn : maybeFn;

  if (!Array.isArray(tables) || typeof fn !== "function") {
    return Effect.die(new Error("Invalid runTx invocation"));
  }

  return Effect.gen(function* () {
    const capturedContext = yield* Effect.context<R>();
    const afterCommitEffects: Array<AfterCommitEffect> = [];

    const result = yield* Effect.tryPromise({
      try: () =>
        runtimeDb.transaction(mode, tables, async () => {
          if (!Dexie.currentTransaction) {
            throw new Error("Dexie transaction unavailable");
          }

          const exit = await Effect.runPromiseExit(
            fn().pipe(
              Effect.provideService(RuntimeDbTxContext, {
                registerAfterCommit: (effect) => {
                  afterCommitEffects.push(effect);
                },
              }),
              Effect.provide(capturedContext),
            ),
          );

          if (Exit.isSuccess(exit)) {
            return exit.value;
          }

          throw txBodyFailure(exit.cause);
        }),
      catch: (error) => error,
    }).pipe(
      Effect.catchAll((error) =>
        isTxBodyFailure(error)
          ? Effect.failCause(error.cause)
          : Effect.fail(error),
      ),
    );

    if (afterCommitEffects.length > 0) {
      yield* Effect.sync(() => {
        Effect.runFork(drainAfterCommitEffects(afterCommitEffects));
      });
    }

    return result;
  });
}

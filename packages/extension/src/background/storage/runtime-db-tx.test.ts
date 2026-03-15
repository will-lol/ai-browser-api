import Dexie from "dexie";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";

const transactionCalls: Array<{
  mode: "r" | "rw";
  tables: ReadonlyArray<unknown>;
}> = [];

let transactionImpl: (
  mode: "r" | "rw",
  tables: ReadonlyArray<unknown>,
  fn: () => Promise<unknown>,
) => Promise<unknown> = (_mode, _tables, fn) => withCurrentTransaction(fn);

vi.doMock("@/background/storage/runtime-db", () => ({
  runtimeDb: {
    transaction: (
      mode: "r" | "rw",
      tables: ReadonlyArray<unknown>,
      fn: () => Promise<unknown>,
    ) => {
      transactionCalls.push({ mode, tables });
      return transactionImpl(mode, tables, fn);
    },
  },
}));

const { afterCommit, runTx } = await import("./runtime-db-tx");

const AfterCommitLabel = Context.GenericTag<string>(
  "@llm-bridge/extension/test/AfterCommitLabel",
);

function withCurrentTransaction<T>(fn: () => Promise<T>): Promise<T> {
  const previousDescriptor = Object.getOwnPropertyDescriptor(
    Dexie,
    "currentTransaction",
  );

  Object.defineProperty(Dexie, "currentTransaction", {
    configurable: true,
    value: {},
  });

  return Promise.resolve()
    .then(fn)
    .finally(() => {
      if (previousDescriptor) {
        Object.defineProperty(Dexie, "currentTransaction", previousDescriptor);
        return;
      }

      Reflect.deleteProperty(Dexie, "currentTransaction");
    });
}

function waitForDrainTick() {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

async function withMutedWarnings<T>(
  fn: (warnMock: ReturnType<typeof vi.fn>) => Promise<T>,
) {
  const warnMock = vi.spyOn(console, "warn").mockImplementation(() => undefined);

  try {
    return await fn(warnMock);
  } finally {
    warnMock.mockRestore();
  }
}

beforeEach(() => {
  transactionCalls.length = 0;
  transactionImpl = (_mode, _tables, fn) => withCurrentTransaction(fn);
});

describe("runTx", () => {
  it("succeeds when afterCommit fails asynchronously", async () => {
    await withMutedWarnings(async (warnMock) => {
      const result = await Effect.runPromise(
        runTx([], () =>
          Effect.gen(function* () {
            yield* afterCommit(
              Effect.tryPromise({
                try: () => Promise.reject(new Error("async failure")),
                catch: (error) => error,
              }),
            );
            return "ok";
          }),
        ),
      );

      expect(result).toBe("ok");
      await waitForDrainTick();
      expect(warnMock).toHaveBeenCalledTimes(1);
    });
  });

  it("succeeds when afterCommit throws synchronously", async () => {
    await withMutedWarnings(async (warnMock) => {
      const result = await Effect.runPromise(
        runTx([], () =>
          Effect.gen(function* () {
            yield* afterCommit(
              Effect.sync(() => {
                throw new Error("sync failure");
              }),
            );
            return "ok";
          }),
        ),
      );

      expect(result).toBe("ok");
      await waitForDrainTick();
      expect(warnMock).toHaveBeenCalledTimes(1);
    });
  });

  it("does not wait for never-ending post-commit work", async () => {
    const result = await Promise.race([
      Effect.runPromise(
        runTx([], () =>
          Effect.gen(function* () {
            yield* afterCommit(Effect.never);
            return "ok";
          }),
        ),
      ),
      new Promise<string>((resolve) => {
        setTimeout(() => resolve("timeout"), 25);
      }),
    ]);

    expect(result).toBe("ok");
  });

  it("continues draining after one afterCommit failure", async () => {
    await withMutedWarnings(async (warnMock) => {
      const drained: string[] = [];

      const result = await Effect.runPromise(
        runTx([], () =>
          Effect.gen(function* () {
            yield* afterCommit(
              Effect.fail(new Error("first failure")),
            );
            yield* afterCommit(
              Effect.sync(() => {
                drained.push("second");
              }),
            );
            return "ok";
          }),
        ),
      );

      expect(result).toBe("ok");
      await waitForDrainTick();
      expect(drained).toEqual(["second"]);
      expect(warnMock).toHaveBeenCalledTimes(1);
    });
  });

  it("preserves typed failure from the transaction body", async () => {
    const result = await Effect.runPromise(
      Effect.either(
        runTx([], () =>
          Effect.fail("typed failure"),
        ),
      ),
    );

    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left).toBe("typed failure");
    }
  });

  it("preserves defects from the transaction body", async () => {
    const exit = await Effect.runPromiseExit(
      runTx([], () =>
        Effect.die(new Error("boom")),
      ),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const defect = Cause.squash(exit.cause);
      expect(defect).toBeInstanceOf(Error);
      if (defect instanceof Error) {
        expect(defect.message).toContain("boom");
      }
    }
  });

  it("dies when afterCommit is called outside runTx", async () => {
    const exit = await Effect.runPromiseExit(afterCommit(Effect.void));

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const defect = Cause.squash(exit.cause);
      expect(defect).toBeInstanceOf(Error);
      if (defect instanceof Error) {
        expect(defect.message).toContain(
          "afterCommit must be called inside runTx",
        );
      }
    }
  });

  it("captures and reuses provided Effect context for afterCommit work", async () => {
    const seen: string[] = [];

    const result = await Effect.runPromise(
      runTx([], () =>
        Effect.gen(function* () {
          yield* afterCommit(
            Effect.gen(function* () {
              const label = yield* AfterCommitLabel;
              yield* Effect.sync(() => {
                seen.push(label);
              });
            }),
          );
          return "ok";
        }),
      ).pipe(
        Effect.provideService(AfterCommitLabel, "captured"),
      ),
    );

    expect(result).toBe("ok");
    await waitForDrainTick();
    expect(seen).toEqual(["captured"]);
  });
});

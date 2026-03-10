import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import Dexie, { type Transaction } from "dexie";
import { runtimeDb } from "@/background/storage/runtime-db";
import { afterCommit, runTx } from "@/background/storage/runtime-db-tx";

const originalTransaction = runtimeDb.transaction;
const originalCurrentTransactionDescriptor = Object.getOwnPropertyDescriptor(
  Dexie,
  "currentTransaction",
);

function installMockTransaction() {
  const transaction = {} as Transaction;
  const transactionStub = (async (
    _mode: unknown,
    _tables: unknown,
    fn: () => unknown,
  ) => fn()) as unknown as typeof runtimeDb.transaction;

  Object.defineProperty(Dexie, "currentTransaction", {
    configurable: true,
    get: () => transaction,
  });
  (runtimeDb as { transaction: typeof runtimeDb.transaction }).transaction =
    transactionStub;
}

async function waitForDrainTick() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function withMutedWarnings<T>(run: () => Promise<T>) {
  const originalWarn = console.warn;
  console.warn = () => undefined;
  try {
    return await run();
  } finally {
    console.warn = originalWarn;
  }
}

afterEach(() => {
  (runtimeDb as { transaction: typeof runtimeDb.transaction }).transaction =
    originalTransaction;

  if (originalCurrentTransactionDescriptor) {
    Object.defineProperty(
      Dexie,
      "currentTransaction",
      originalCurrentTransactionDescriptor,
    );
  }
});

describe("runTx", () => {
  it("returns success when afterCommit rejects", async () => {
    installMockTransaction();

    const result = await withMutedWarnings(async () =>
      runTx([], () => {
        afterCommit(async () => {
          throw new Error("async failure");
        });
        return "ok";
      }),
    );

    assert.equal(result, "ok");
    await waitForDrainTick();
  });

  it("returns success when afterCommit throws synchronously", async () => {
    installMockTransaction();

    const result = await withMutedWarnings(async () =>
      runTx([], () => {
        afterCommit(() => {
          throw new Error("sync failure");
        });
        return "ok";
      }),
    );

    assert.equal(result, "ok");
    await waitForDrainTick();
  });

  it("does not wait for long-running afterCommit effects", async () => {
    installMockTransaction();

    const never = new Promise<void>(() => {
      // Keep pending forever to assert runTx does not await afterCommit completion.
    });

    const outcome = await Promise.race([
      runTx([], () => {
        afterCommit(() => never);
        return "ok";
      }).then(() => "resolved" as const),
      new Promise<"timed_out">((resolve) => {
        setTimeout(() => resolve("timed_out"), 50);
      }),
    ]);

    assert.equal(outcome, "resolved");
  });

  it("continues draining effects after one failure", async () => {
    installMockTransaction();

    const order: string[] = [];

    await withMutedWarnings(async () =>
      runTx([], () => {
        afterCommit(() => {
          order.push("first");
          throw new Error("first failed");
        });

        afterCommit(async () => {
          order.push("second");
        });

        return "ok";
      }),
    );

    await waitForDrainTick();

    assert.deepEqual(order, ["first", "second"]);
  });

  it("logs one warning per failing afterCommit effect", async () => {
    installMockTransaction();

    const warnings: unknown[][] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args);
    };

    try {
      await runTx([], () => {
        afterCommit(() => {
          throw new Error("first");
        });

        afterCommit(async () => {
          throw new Error("second");
        });

        return "ok";
      });

      await waitForDrainTick();
    } finally {
      console.warn = originalWarn;
    }

    assert.equal(warnings.length, 2);
    assert.equal(warnings[0]?.[0], "runTx afterCommit effect failed");
    assert.equal(warnings[1]?.[0], "runTx afterCommit effect failed");
  });
});

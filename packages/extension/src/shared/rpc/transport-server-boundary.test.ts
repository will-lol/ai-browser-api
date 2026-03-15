import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { mock } from "@/test-utils/vitest-compat";
import * as Effect from "effect/Effect";
import * as Mailbox from "effect/Mailbox";
import {
  makeOnceTransportCleanup,
  offerMailboxFromCallback,
  runDetachedTransportServerEffect,
} from "./transport-server-boundary";

const warnMock = mock((_message?: unknown, _details?: unknown) => undefined);
const originalWarn = console.warn;

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 250,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) {
      return;
    }

    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }

  throw new Error("Timed out waiting for condition");
}

afterEach(() => {
  warnMock.mockClear();
  console.warn = originalWarn;
});

describe("transport-server-boundary", () => {
  it("routes detached failures through the provided handler", async () => {
    const failure = await new Promise<unknown>((resolve) => {
      runDetachedTransportServerEffect(Effect.fail(new Error("boom")), {
        onError: resolve,
      });
    });

    assert.equal(failure instanceof Error, true);
    if (failure instanceof Error) {
      assert.equal(failure.message, "boom");
    }
  });

  it("suppresses duplicate cleanup work", async () => {
    let cleanupCalls = 0;
    const cleanup = makeOnceTransportCleanup((_reason: string) =>
      Effect.sync(() => {
        cleanupCalls += 1;
      }),
    );

    await Effect.runPromise(cleanup("first"));
    await Effect.runPromise(cleanup("second"));

    assert.equal(cleanupCalls, 1);
  });

  it("offers values into a mailbox from callback code", async () => {
    const mailbox = await Effect.runPromise(Mailbox.make<number>());

    offerMailboxFromCallback(mailbox, 42, {
      onError: () => {
        throw new Error("unexpected mailbox offer failure");
      },
    });

    await waitFor(() => mailbox.unsafeSize()?._tag === "Some");
    const value = await Effect.runPromise(mailbox.take);
    assert.equal(value, 42);
  });

  it("tolerates offering into a shutdown mailbox", async () => {
    console.warn = warnMock;
    const mailbox = await Effect.runPromise(Mailbox.make<number>());
    await Effect.runPromise(mailbox.shutdown);

    offerMailboxFromCallback(mailbox, 7);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    assert.equal(warnMock.mock.calls.length, 0);
  });
});

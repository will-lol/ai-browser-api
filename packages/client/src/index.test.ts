import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as Effect from "effect/Effect";
import { BridgeClient, withBridgeClient } from "./index";

describe("BridgeClientLive connection lifecycle", () => {
  it("recreates connection after a transient connect failure", async () => {
    const events: Array<string> = [];
    const logger: typeof console.info = (...args: Array<unknown>) => {
      const event = args[2];
      if (typeof event === "string") {
        events.push(event);
      }
    };

    const globals = globalThis as typeof globalThis & {
      MessageChannel: typeof MessageChannel;
    };
    const originalMessageChannel = globals.MessageChannel;

    globals.MessageChannel = class {
      constructor() {
        throw new Error("forced connect failure");
      }
    } as unknown as typeof MessageChannel;

    try {
      await Effect.runPromise(
        withBridgeClient(
          Effect.gen(function* () {
            const client = yield* BridgeClient;
            const first = yield* Effect.either(client.listModels);
            const second = yield* Effect.either(client.listModels);

            assert.equal(first._tag, "Left");
            assert.equal(second._tag, "Left");
          }),
          {
            debug: true,
            logger,
            timeoutMs: 5,
          },
        ),
      );
    } finally {
      globals.MessageChannel = originalMessageChannel;
    }

    const createCount = events.filter(
      (event) => event === "rpc.connection.create",
    ).length;
    assert.equal(createCount, 2);
  });
});

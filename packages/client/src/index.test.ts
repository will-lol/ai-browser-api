import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as Effect from "effect/Effect";
import { BridgeClient, withBridgeClient } from "./index";

describe("BridgeClientLive connection lifecycle", () => {
  it("recreates connection after a transient connect failure", async () => {
    const globals = globalThis as typeof globalThis & {
      MessageChannel: typeof MessageChannel;
    };
    const originalMessageChannel = globals.MessageChannel;
    let attempts = 0;

    globals.MessageChannel = class {
      constructor() {
        attempts += 1;
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
            timeoutMs: 5,
          },
        ),
      );
    } finally {
      globals.MessageChannel = originalMessageChannel;
    }

    assert.equal(attempts, 2);
  });
});

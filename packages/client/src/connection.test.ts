import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { RuntimeValidationError } from "@llm-bridge/contracts";
import * as Effect from "effect/Effect";
import { createConnection } from "./connection";

describe("createConnection", () => {
  it("fails outside a trusted browser context instead of fabricating an origin", async () => {
    const originalWindow = Reflect.get(globalThis, "window");

    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: undefined,
    });

    try {
      const result = await Effect.runPromise(
        Effect.either(createConnection(1, {})),
      );

      assert.equal(result._tag, "Left");
      if (result._tag === "Left") {
        assert.equal(result.left instanceof RuntimeValidationError, true);
        assert.match(result.left.message, /trusted browser window origin/i);
      }
    } finally {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: originalWindow,
      });
    }
  });
});

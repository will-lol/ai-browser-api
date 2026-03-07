import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as Cause from "effect/Cause";
import * as FiberId from "effect/FiberId";
import { isInterruptedOnlyCause } from "./effect-cause";

describe("isInterruptedOnlyCause", () => {
  it("returns true for interrupt-only causes", () => {
    assert.equal(
      isInterruptedOnlyCause(Cause.interrupt(FiberId.none)),
      true,
    );
  });

  it("returns false for domain failures", () => {
    assert.equal(isInterruptedOnlyCause(Cause.fail("boom")), false);
  });

  it("returns false for non-cause values", () => {
    assert.equal(isInterruptedOnlyCause(new Error("boom")), false);
  });
});

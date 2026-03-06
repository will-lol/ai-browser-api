import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeValueForCache } from "@/lib/runtime/ai/adapter-state";

describe("adapter-state cache normalization", () => {
  it("assigns stable cache markers for repeated function references", () => {
    const fn = () => "ok";

    const first = normalizeValueForCache({
      fetch: fn,
      nested: {
        fetch: fn,
      },
    }) as Record<string, unknown>;

    const second = normalizeValueForCache({
      fetch: fn,
      nested: {
        fetch: fn,
      },
    }) as Record<string, unknown>;

    assert.deepEqual(first, second);
  });

  it("assigns different markers for different function references", () => {
    const first = normalizeValueForCache({
      fetch: () => "first",
    }) as Record<string, unknown>;

    const second = normalizeValueForCache({
      fetch: () => "second",
    }) as Record<string, unknown>;

    assert.notDeepEqual(first, second);
  });
});

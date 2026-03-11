import assert from "node:assert/strict";
import { Result } from "@effect-atom/atom-react";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import { describe, it } from "node:test";
import { combineQueryStates, toReactiveQueryState } from "./state";

describe("reactive query state", () => {
  it("preserves a stale value while a query is waiting", () => {
    const state = toReactiveQueryState(Result.waiting(Result.success("ready")));

    assert.equal(state.status, "loading");
    assert.equal(state.isLoading, true);
    assert.equal(state.value, "ready");
    assert.equal(state.error, null);
  });

  it("surfaces failures with the previous success value when available", () => {
    const result = Result.failure(Cause.fail("boom"), {
      previousSuccess: Option.some(Result.success(["a"])),
    });
    const state = toReactiveQueryState(result);

    assert.equal(state.status, "error");
    assert.deepEqual(state.value, ["a"]);
    assert.equal(state.error?.message, "boom");
  });

  it("combines ready query states into one ready state", () => {
    const state = combineQueryStates({
      providers: toReactiveQueryState(Result.success(["openai"])),
      authFlow: toReactiveQueryState(
        Result.success({
          status: "idle",
        }),
      ),
    });

    assert.equal(state.status, "ready");
    assert.deepEqual(state.value, {
      providers: ["openai"],
      authFlow: {
        status: "idle",
      },
    });
  });

  it("keeps combined stale values while a dependency is refreshing", () => {
    const state = combineQueryStates({
      providers: toReactiveQueryState(Result.waiting(Result.success(["openai"]))),
      authFlow: toReactiveQueryState(
        Result.waiting(
          Result.success({
            status: "idle",
          }),
        ),
      ),
    });

    assert.equal(state.status, "loading");
    assert.deepEqual(state.value, {
      providers: ["openai"],
      authFlow: {
        status: "idle",
      },
    });
  });
});

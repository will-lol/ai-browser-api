import assert from "node:assert/strict";
import { describe, it } from "vitest";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import {
  bindRuntimeRpcStreamMethod,
  bindRuntimeRpcUnaryMethod,
} from "./runtime-rpc-client-facade";

class TestError extends Error {}

type FakeClient = {
  readonly ping: (payload: {
    readonly value: string;
  }) => Effect.Effect<string, TestError>;
  readonly watch: (payload: {
    readonly value: string;
  }) => Stream.Stream<string, TestError>;
};

describe("makeRuntimeRpcFacade", () => {
  it("binds unary methods through ensureClient", async () => {
    const calls: Array<{ value: string }> = [];
    const client: FakeClient = {
      ping: (payload) =>
        Effect.sync(() => {
          calls.push(payload);
          return payload.value.toUpperCase();
        }),
      watch: () => Stream.empty,
    };

    const ping = bindRuntimeRpcUnaryMethod(
      Effect.succeed(client),
      (current) => current.ping,
    );

    const result = await Effect.runPromise(ping({ value: "hello" }));

    assert.equal(result, "HELLO");
    assert.deepEqual(calls, [{ value: "hello" }]);
  });

  it("unwraps stream methods through ensureClient", async () => {
    const calls: Array<{ value: string }> = [];
    const client: FakeClient = {
      ping: () => Effect.succeed("unused"),
      watch: (payload) =>
        Stream.sync(() => {
          calls.push(payload);
          return payload.value;
        }),
    };

    const watch = bindRuntimeRpcStreamMethod(
      Effect.succeed(client),
      (current) => current.watch,
    );

    const result = await Effect.runPromise(
      Stream.runCollect(watch({ value: "hello" })),
    );

    assert.deepEqual(Array.from(result), ["hello"]);
    assert.deepEqual(calls, [{ value: "hello" }]);
  });

  it("propagates ensureClient failures unchanged for unary and stream methods", async () => {
    const failure = new TestError("invalidated");
    const failedEnsureClient: Effect.Effect<FakeClient, TestError> =
      Effect.fail(failure);
    const ping = bindRuntimeRpcUnaryMethod(
      failedEnsureClient,
      (current) => current.ping,
    );
    const watch = bindRuntimeRpcStreamMethod(
      failedEnsureClient,
      (current) => current.watch,
    );

    const unaryError = await Effect.runPromise(
      ping({ value: "hello" }).pipe(
        Effect.flip,
      ),
    );
    const streamError = await Effect.runPromise(
      Stream.runCollect(watch({ value: "hello" })).pipe(
        Effect.flip,
      ),
    );

    assert.strictEqual(unaryError, failure);
    assert.strictEqual(streamError, failure);
  });
});

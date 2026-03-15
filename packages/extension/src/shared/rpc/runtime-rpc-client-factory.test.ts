import assert from "node:assert/strict";
import * as Rpc from "@effect/rpc/Rpc";
import * as RpcGroup from "@effect/rpc/RpcGroup";
import { describe, it } from "bun:test";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import type { RuntimeRpcClientConnection } from "./runtime-rpc-client-core";
import {
  bindRuntimeRpcStreamMethodByKey,
  bindRuntimeRpcUnaryMethodByKey,
} from "./runtime-rpc-client-factory";

const PingRpc = Rpc.make("ping", {
  payload: Schema.Struct({
    value: Schema.String,
  }),
  success: Schema.String,
  error: Schema.Never,
});

const WatchRpc = Rpc.make("watch", {
  payload: Schema.Struct({
    value: Schema.String,
  }),
  success: Schema.String,
  stream: true,
  error: Schema.Never,
});

const FakeRpcGroup = RpcGroup.make(PingRpc, WatchRpc);
type FakeRpcs = RpcGroup.Rpcs<typeof FakeRpcGroup>;

describe("runtime rpc client method helpers", () => {
  it("binds unary and stream methods by key", async () => {
    const calls: Array<string> = [];
    const client = {
      ping: (payload) =>
        Effect.sync(() => {
          calls.push(`ping:${payload.value}`);
          return payload.value.toUpperCase();
        }),
      watch: (payload) =>
        Stream.sync(() => {
          calls.push(`watch:${payload.value}`);
          return payload.value;
        }),
    } as RuntimeRpcClientConnection<FakeRpcs>;

    const ensureClient = Effect.succeed(client);
    const ping = bindRuntimeRpcUnaryMethodByKey<FakeRpcs, never, "ping">(
      ensureClient,
      "ping",
    );
    const watch = bindRuntimeRpcStreamMethodByKey<FakeRpcs, never, "watch">(
      ensureClient,
      "watch",
    );

    assert.equal(await Effect.runPromise(ping({ value: "hello" })), "HELLO");
    const streamed = await Effect.runPromise(
      Stream.runCollect(watch({ value: "world" })),
    );
    assert.deepEqual(Array.from(streamed), ["world"]);
    assert.deepEqual(calls, ["ping:hello", "watch:world"]);
  });
});

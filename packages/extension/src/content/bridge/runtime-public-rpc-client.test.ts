import assert from "node:assert/strict";
import { describe, it, mock } from "bun:test";
import type { RuntimeValidationError } from "@llm-bridge/contracts";
import * as Effect from "effect/Effect";

const ensureClient: Effect.Effect<never, RuntimeValidationError> = Effect.die(
  "unused",
);

mock.module("@/shared/rpc/runtime-rpc-client-core", () => ({
  makeRuntimeRpcClientCore: () => ({
    ensureClient,
  }),
}));

const { getRuntimePublicRPC } = await import("./runtime-public-rpc-client");

describe("getRuntimePublicRPC", () => {
  it("exposes only the public surface", () => {
    const runtime = getRuntimePublicRPC();

    assert.equal("streamProviders" in runtime, false);
    assert.equal("openProviderAuthWindow" in runtime, false);
    assert.equal(typeof runtime.listModels, "function");
    assert.equal(typeof runtime.chatReconnectStream, "function");
  });
});

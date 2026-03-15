import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { mock } from "@/test-utils/vitest-compat";
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

const { getRuntimeAdminRPC } = await import("./runtime-rpc-client");

describe("getRuntimeAdminRPC", () => {
  it("exposes the admin surface", () => {
    const runtime = getRuntimeAdminRPC();

    assert.equal(typeof runtime.listProviders, "function");
    assert.equal(typeof runtime.streamProviders, "function");
    assert.equal(typeof runtime.openProviderAuthWindow, "function");
    assert.equal(typeof runtime.resolvePermissionRequest, "function");
  });
});

import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import {
  RuntimeInternalError,
  RuntimeValidationError,
} from "@llm-bridge/contracts";
import { AuthRepository } from "@llm-bridge/runtime-core";
import * as Effect from "effect/Effect";

const openProviderAuthWindowMock = mock(async () => {
  throw new Error("window failed");
});

mock.module("@/lib/runtime/auth-flow-manager", () => ({
  getAuthFlowManager: () => ({
    openProviderAuthWindow: openProviderAuthWindowMock,
    getProviderAuthFlow: async (providerID: string) => ({
      providerID,
      status: "idle" as const,
      methods: [],
      updatedAt: 1,
      canCancel: false,
    }),
    startProviderAuthFlow: async (input: { providerID: string }) => ({
      providerID: input.providerID,
      status: "idle" as const,
      methods: [],
      updatedAt: 1,
      canCancel: false,
    }),
    cancelProviderAuthFlow: async (input: { providerID: string }) => ({
      providerID: input.providerID,
      status: "canceled" as const,
      methods: [],
      updatedAt: 1,
      canCancel: false,
    }),
  }),
}));

const { makeRuntimeCoreInfrastructureLayer } = await import("./runtime-adapters");

beforeEach(() => {
  openProviderAuthWindowMock.mockReset();
});

afterAll(() => {
  mock.restore();
});

describe("runtime-adapters error normalization", () => {
  it("wraps unknown auth manager failures before they enter runtime-core", async () => {
    openProviderAuthWindowMock.mockRejectedValueOnce(new Error("window failed"));

    const result = await Effect.runPromise(
      Effect.either(
        Effect.gen(function* () {
          const repo = yield* AuthRepository;
          return yield* repo.openProviderAuthWindow("openai");
        }).pipe(Effect.provide(makeRuntimeCoreInfrastructureLayer())),
      ),
    );

    expect("left" in result).toBe(true);
    if ("left" in result) {
      expect(result.left).toEqual(
        new RuntimeInternalError({
          operation: "auth.openProviderAuthWindow",
          message: "window failed",
        }),
      );
    }
  });

  it("preserves tagged runtime errors from auth manager boundaries", async () => {
    openProviderAuthWindowMock.mockRejectedValueOnce(
      new RuntimeValidationError({
        message: "Provider is unavailable",
      }),
    );

    const result = await Effect.runPromise(
      Effect.either(
        Effect.gen(function* () {
          const repo = yield* AuthRepository;
          return yield* repo.openProviderAuthWindow("openai");
        }).pipe(Effect.provide(makeRuntimeCoreInfrastructureLayer())),
      ),
    );

    expect("left" in result).toBe(true);
    if ("left" in result) {
      expect(result.left).toEqual(
        new RuntimeValidationError({
          message: "Provider is unavailable",
        }),
      );
    }
  });
});

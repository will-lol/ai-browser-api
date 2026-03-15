import { describe, expect, it } from "vitest";
import {
  RuntimeDefectError,
  RuntimeValidationError,
} from "@llm-bridge/contracts";
import * as Effect from "effect/Effect";
import { serializeRpcError } from "@/background/rpc/runtime-rpc-handlers";

describe("serializeRpcError", () => {
  it("passes through typed runtime failures", async () => {
    const result = await Effect.runPromise(
      Effect.either(
        serializeRpcError(
          Effect.fail(
            new RuntimeValidationError({
              message: "missing origin",
            }),
          ),
        ),
      ),
    );

    expect("left" in result).toBe(true);
    if ("left" in result) {
      expect(result.left).toEqual(
        new RuntimeValidationError({
          message: "missing origin",
        }),
      );
    }
  });

  it("converts defects into RuntimeDefectError at the rpc boundary", async () => {
    const result = await Effect.runPromise(
      Effect.either(
        serializeRpcError(
          Effect.sync(() => {
            throw new Error("boom");
          }),
        ),
      ),
    );

    expect("left" in result).toBe(true);
    if ("left" in result) {
      expect(result.left).toEqual(
        new RuntimeDefectError({
          defect: "Error: boom",
        }),
      );
    }
  });
});

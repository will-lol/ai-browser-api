import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Effect from "effect/Effect";

let configRow:
  | {
      id: string;
      value: Record<string, unknown>;
    }
  | undefined;

vi.doMock("@/background/storage/runtime-db", () => ({
  runtimeDb: {
    config: {
      get: async (_id: string) => configRow,
    },
  },
}));

const { getRuntimeConfig } = await import("./config-store");

beforeEach(() => {
  configRow = undefined;
});

describe("getRuntimeConfig", () => {
  it("returns an empty object when no config row exists", async () => {
    const result = await Effect.runPromise(getRuntimeConfig());

    expect(result).toEqual({});
  });

  it("returns the stored runtime config value", async () => {
    configRow = {
      id: "runtime-config",
      value: {
        model: "openai/gpt-4o-mini",
        enabled_providers: ["openai"],
        provider: {
          openai: {
            name: "OpenAI",
          },
        },
      },
    };

    const result = await Effect.runPromise(getRuntimeConfig());

    expect(result).toEqual(configRow.value);
  });
});

import { describe, expect, it } from "vitest";
import * as Effect from "effect/Effect";
import { getModelsDevData, modelsDevData } from "@/background/runtime/catalog/models-dev";
import {
  parseModelsDevData,
  parseModelsDevSnapshotText,
} from "@/background/runtime/catalog/models-dev-schema";

describe("models.dev snapshot parsing", () => {
  it("parses valid data and applies key-based id/name fallbacks", () => {
    const parsed = parseModelsDevData({
      providerKey: {
        env: ["PROVIDER_API_KEY"],
        doc: "https://docs.example.test/provider",
        models: {
          modelKey: {
            release_date: "2026-01-01",
            attachment: false,
            reasoning: true,
            tool_call: true,
            limit: {
              context: 128000,
              output: 16000,
            },
            extra_model_field: "preserved",
          },
        },
      },
    });

    expect(parsed.providerKey.id).toBe("providerKey");
    expect(parsed.providerKey.name).toBe("providerKey");
    expect(parsed.providerKey.models.modelKey.id).toBe("modelKey");
    expect(parsed.providerKey.models.modelKey.name).toBe("modelKey");
    expect(parsed.providerKey.models.modelKey.temperature).toBe(false);
    expect((parsed.providerKey as unknown as Record<string, unknown>).doc).toBe(
      "https://docs.example.test/provider",
    );
    expect(
      (parsed.providerKey.models.modelKey as unknown as Record<string, unknown>)
        .extra_model_field,
    ).toBe("preserved");
  });

  it("rejects invalid top-level snapshots", () => {
    expect(() => parseModelsDevData([])).toThrow(Error);
  });

  it("rejects invalid provider entries", () => {
    expect(() =>
      parseModelsDevData({
        providerKey: {
          env: "PROVIDER_API_KEY",
          models: {},
        },
      }),
    ).toThrow(Error);
  });

  it("rejects invalid model entries", () => {
    expect(() =>
      parseModelsDevData({
        providerKey: {
          env: ["PROVIDER_API_KEY"],
          models: {
            modelKey: {
              release_date: "2026-01-01",
              attachment: false,
              reasoning: true,
              tool_call: "yes",
              limit: {
                context: 128000,
                output: 16000,
              },
            },
          },
        },
      }),
    ).toThrow(Error);
  });

  it("rejects malformed snapshot text used by the update script", () => {
    expect(() => parseModelsDevSnapshotText("{")).toThrow(SyntaxError);
    expect(() =>
      parseModelsDevSnapshotText(
        JSON.stringify({
          providerKey: {
            env: ["PROVIDER_API_KEY"],
            models: {
              modelKey: {
                release_date: "2026-01-01",
                attachment: false,
                reasoning: true,
                tool_call: true,
              },
            },
          },
        }),
      ),
    ).toThrow(Error);
  });

  it("returns the canonical typed snapshot through getModelsDevData", async () => {
    const parsed = await Effect.runPromise(getModelsDevData());

    expect(parsed).toBe(modelsDevData);
    expect(Object.keys(parsed).length).toBeGreaterThan(0);
  });
});

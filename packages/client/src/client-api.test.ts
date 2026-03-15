import assert from "node:assert/strict";
import { describe, it } from "vitest";
import * as Effect from "effect/Effect";
import { makeBridgeClientApi } from "./client-api";

describe("makeBridgeClientApi", () => {
  it("omits caller-controlled origin fields from page bridge payloads", async () => {
    const listModelsCalls: Array<Record<string, unknown>> = [];
    const permissionCalls: Array<Record<string, unknown>> = [];
    const acquireCalls: Array<Record<string, unknown>> = [];

    const api = makeBridgeClientApi({
      ensureConnection: Effect.succeed({
        client: {
          listModels: (input: Record<string, unknown>) =>
            Effect.sync(() => {
              listModelsCalls.push(input);
              return [];
            }),
          createPermissionRequest: (input: Record<string, unknown>) =>
            Effect.sync(() => {
              permissionCalls.push(input);
              return {
                status: "alreadyAllowed" as const,
              };
            }),
          acquireModel: (input: Record<string, unknown>) =>
            Effect.sync(() => {
              acquireCalls.push(input);
              return {
                specificationVersion: "v3" as const,
                provider: "openai",
                modelId: "openai/gpt-4o-mini",
                supportedUrls: {},
              };
            }),
        },
      } as never),
      destroy: Effect.void,
      abortChatStream: () => Effect.void,
      createLanguageModel: () => ({}) as never,
      nextModelRequestId: () => "model-request-1",
    });

    await api.listModels();
    await api.requestPermission({
      modelId: "openai/gpt-4o-mini",
    });
    await api.getModel("openai/gpt-4o-mini");

    assert.deepEqual(listModelsCalls, [
      {
        connectedOnly: true,
      },
    ]);
    assert.deepEqual(permissionCalls, [
      {
        modelId: "openai/gpt-4o-mini",
      },
    ]);
    assert.deepEqual(acquireCalls, [
      {
        requestId: "model-request-1",
        sessionID: "model-request-1",
        modelId: "openai/gpt-4o-mini",
      },
    ]);
  });
});

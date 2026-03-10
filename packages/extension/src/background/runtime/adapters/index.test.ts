import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  resolveAdapterForModel,
  resolveAdapterForProvider,
} from "@/background/runtime/adapters";

describe("adapter resolver", () => {
  it("prefers provider overrides before generic npm adapters", () => {
    const adapter = resolveAdapterForProvider({
      providerID: "openai",
      source: {
        id: "openai",
        name: "OpenAI",
        env: ["OPENAI_API_KEY"],
        npm: "@ai-sdk/openai",
        models: {},
      },
    });

    assert.ok(adapter);
    assert.equal(adapter.key, "provider:openai");
  });

  it("falls back to generic npm adapters for shared SDK packages", () => {
    const adapter = resolveAdapterForModel({
      providerID: "groq",
      model: {
        id: "llama",
        providerID: "groq",
        name: "Llama",
        status: "active",
        api: {
          id: "llama",
          url: "https://api.groq.com/openai/v1",
          npm: "@ai-sdk/openai-compatible",
        },
        cost: {
          input: 0,
          output: 0,
          cache: {
            read: 0,
            write: 0,
          },
        },
        limit: {
          context: 1,
          output: 1,
        },
        options: {},
        headers: {},
        capabilities: {
          temperature: true,
          reasoning: false,
          attachment: false,
          toolcall: true,
          input: {
            text: true,
            audio: false,
            image: false,
            video: false,
            pdf: false,
          },
          output: {
            text: true,
            audio: false,
            image: false,
            video: false,
            pdf: false,
          },
        },
      },
    });

    assert.ok(adapter);
    assert.equal(adapter.key, "@ai-sdk/openai-compatible");
  });
});

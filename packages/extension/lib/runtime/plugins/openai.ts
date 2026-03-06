import type { RuntimePlugin } from "@/lib/runtime/plugin-manager";

export const openaiPlugin: RuntimePlugin = {
  id: "builtin-openai",
  name: "Builtin OpenAI Behaviors",
  supportedProviders: [
    "openai",
    "opencode",
    "azure",
    "azure-cognitive-services",
  ],
  hooks: {
    chat: {
      async headers(_ctx, headers) {
        return {
          strategy: "merge",
          value: {
            ...headers,
            "x-llm-bridge-originator": "llm-bridge",
          },
        };
      },
    },
  },
};

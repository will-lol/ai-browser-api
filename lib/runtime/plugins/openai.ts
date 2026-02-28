import type { RuntimePlugin } from "@/lib/runtime/types"

export const openaiPlugin: RuntimePlugin = {
  id: "builtin-openai",
  name: "Builtin OpenAI Behaviors",
  supportedProviders: ["openai", "opencode", "azure", "azure-cognitive-services"],
  hooks: {
    provider: {
      async requestOptions(_ctx, options) {
        if (typeof options.model === "string" && options.model.startsWith("gpt-5")) {
          return {
            strategy: "merge",
            value: {
              store: false,
              reasoning: {
                effort: "medium",
              },
            },
          }
        }
        return {
          strategy: "merge",
          value: {
            store: false,
          },
        }
      },
    },
    chat: {
      async headers(_ctx, headers) {
        return {
          strategy: "merge",
          value: {
            ...headers,
            "x-llm-bridge-originator": "llm-bridge",
          },
        }
      },
    },
  },
}

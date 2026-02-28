import type { RuntimePlugin } from "@/lib/runtime/plugin-manager"

export const anthropicPlugin: RuntimePlugin = {
  id: "builtin-anthropic",
  name: "Builtin Anthropic Behaviors",
  supportedProviders: ["anthropic", "amazon-bedrock", "google-vertex-anthropic", "claude-code-router"],
  hooks: {
    chat: {
      async headers() {
        return {
          strategy: "merge",
          value: {
            "anthropic-version": "2023-06-01",
          },
        }
      },
    },
    provider: {
      async requestOptions(_ctx, options) {
        const model = typeof options.model === "string" ? options.model : ""
        if (!model.includes("claude")) return undefined
        return {
          strategy: "merge",
          value: {
            thinking: {
              type: "enabled",
              budgetTokens: 16000,
            },
          },
        }
      },
    },
  },
}

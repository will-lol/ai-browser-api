import type { RuntimePlugin } from "@/lib/runtime/plugin-manager"

export const googlePlugin: RuntimePlugin = {
  id: "builtin-google",
  name: "Builtin Google Behaviors",
  supportedProviders: ["google", "google-vertex", "google-vertex-anthropic"],
  hooks: {
    provider: {
      async requestOptions(_ctx, options) {
        const model = typeof options.model === "string" ? options.model : ""
        if (!model.includes("gemini")) return undefined
        return {
          strategy: "merge",
          value: {
            thinkingConfig: {
              includeThoughts: true,
            },
          },
        }
      },
    },
  },
}

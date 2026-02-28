import type { RuntimePlugin } from "@/lib/runtime/types"

export const apiKeyAuthPlugin: RuntimePlugin = {
  id: "builtin-api-key-auth",
  name: "Builtin API Key Auth",
  hooks: {
    auth: {
      async methods(ctx) {
        return [
          {
            id: "api-key",
            type: "api",
            label: "API Key",
            prompt: [
              {
                key: "apiKey",
                label: ctx.provider.env[0] ?? `${ctx.providerID.toUpperCase()}_API_KEY`,
                placeholder: "Paste API key",
                required: true,
                secret: true,
                description: "Stored encrypted in extension local storage.",
              },
            ],
          },
        ]
      },
      async authorize(_ctx, method, input) {
        if (method.type !== "api") return undefined
        const apiKey = input.apiKey?.trim()
        if (!apiKey) throw new Error("API key is required")
        return {
          type: "api",
          key: apiKey,
        }
      },
    },
  },
}

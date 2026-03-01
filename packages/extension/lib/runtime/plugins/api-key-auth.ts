import type { RuntimePlugin } from "@/lib/runtime/plugin-manager"

export const apiKeyAuthPlugin: RuntimePlugin = {
  id: "builtin-api-key-auth",
  name: "Builtin API Key Auth",
  hooks: {
    auth: {
      provider: "*",
      async methods(ctx) {
        return [
          {
            id: "apikey",
            type: "apikey",
            label: "API Key",
            fields: [
              {
                type: "secret",
                key: "apiKey",
                label: ctx.provider.env[0] ?? `${ctx.providerID.toUpperCase()}_API_KEY`,
                placeholder: "Paste API key",
                required: true,
                description: "Stored encrypted in extension local storage.",
              },
            ],
            async authorize(input) {
              const apiKey = input.values.apiKey?.trim()
              if (!apiKey) throw new Error("API key is required")
              return {
                type: "api",
                key: apiKey,
              }
            },
          },
        ]
      },
    },
  },
}

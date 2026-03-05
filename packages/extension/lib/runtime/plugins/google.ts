import type { RuntimePlugin } from "@/lib/runtime/plugin-manager"

export const googlePlugin: RuntimePlugin = {
  id: "builtin-google",
  name: "Builtin Google Behaviors",
  supportedProviders: ["google", "google-vertex", "google-vertex-anthropic"],
  hooks: {},
}

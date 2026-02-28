import type { RuntimePlugin } from "@/lib/runtime/types"

export const telemetryPlugin: RuntimePlugin = {
  id: "builtin-telemetry",
  name: "Builtin Telemetry",
  hooks: {
    event: {
      async onEvent(name, payload) {
        console.debug(`[llm-bridge:${name}]`, payload)
      },
    },
  },
}

import { ExtensionQueryProvider } from "@/components/extension/extension-query-provider"
import { FloatingPermissionPrompt } from "@/components/extension/floating-permission-prompt"

export function ContentPermissionOverlay() {
  return (
    <ExtensionQueryProvider persist={false}>
      <FloatingPermissionPrompt className="pointer-events-auto" />
    </ExtensionQueryProvider>
  )
}

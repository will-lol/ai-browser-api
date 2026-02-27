"use client"

import { ExtensionProvider } from "@/lib/extension-store"
import { FloatingPermissionPrompt } from "@/components/extension/floating-permission-prompt"

export function ContentPermissionOverlay() {
  return (
    <ExtensionProvider>
      <FloatingPermissionPrompt className="pointer-events-auto" />
    </ExtensionProvider>
  )
}

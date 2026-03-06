import { ExtensionAtomProvider } from "@/components/extension/extension-atom-provider";
import { FloatingPermissionPrompt } from "@/components/extension/floating-permission-prompt";

export function ContentPermissionOverlay() {
  return (
    <ExtensionAtomProvider>
      <FloatingPermissionPrompt className="pointer-events-auto" />
    </ExtensionAtomProvider>
  );
}

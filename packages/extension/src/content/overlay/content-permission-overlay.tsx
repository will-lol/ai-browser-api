import { ExtensionAtomProvider } from "@/app/state/extension-atom-provider";
import { FloatingPermissionPrompt } from "@/content/overlay/floating-permission-prompt";

export function ContentPermissionOverlay() {
  return (
    <ExtensionAtomProvider>
      <FloatingPermissionPrompt className="pointer-events-auto" />
    </ExtensionAtomProvider>
  );
}

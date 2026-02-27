import { ExtensionPopup } from '@/components/extension/extension-popup'
import { ExtensionProvider } from '@/lib/extension-store'

export default function PopupApp() {
  return (
    <ExtensionProvider>
      <div className="h-[500px] w-[340px] overflow-hidden bg-background font-sans">
        <ExtensionPopup />
      </div>
    </ExtensionProvider>
  )
}

import { ExtensionPopup } from '@/components/extension/extension-popup'
import { ExtensionProvider } from '@/lib/extension-store'

export default function PopupApp() {
  return (
    <ExtensionProvider>
      <div className="w-[400px] bg-background">
        <ExtensionPopup />
      </div>
    </ExtensionProvider>
  )
}

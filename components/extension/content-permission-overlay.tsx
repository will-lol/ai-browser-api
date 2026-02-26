"use client"

import { useEffect, useMemo, useState } from "react"
import { ExtensionProvider, useExtension } from "@/lib/extension-store"
import { FloatingPermissionPrompt } from "@/components/extension/floating-permission-prompt"

interface ContentPermissionOverlayProps {
  onVisibilityChange: (visible: boolean) => void
}

function OverlayInner({
  onVisibilityChange,
}: ContentPermissionOverlayProps) {
  const { pendingRequests } = useExtension()
  const [isOpen, setIsOpen] = useState(false)

  const hasVisibleRequests = useMemo(
    () => pendingRequests.some((request) => !request.dismissed),
    [pendingRequests]
  )

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setIsOpen(true)
    }, 900)

    return () => window.clearTimeout(timer)
  }, [])

  useEffect(() => {
    if (!isOpen || !hasVisibleRequests) {
      onVisibilityChange(false)
      return
    }

    onVisibilityChange(true)
  }, [hasVisibleRequests, isOpen, onVisibilityChange])

  if (!isOpen || !hasVisibleRequests) return null

  return (
    <div className="pointer-events-none">
      <FloatingPermissionPrompt
        containerMode="embedded"
        className="pointer-events-auto"
      />
    </div>
  )
}

export function ContentPermissionOverlay({
  onVisibilityChange,
}: ContentPermissionOverlayProps) {
  return (
    <ExtensionProvider>
      <OverlayInner onVisibilityChange={onVisibilityChange} />
    </ExtensionProvider>
  )
}

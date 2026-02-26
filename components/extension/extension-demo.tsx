"use client"

import { useState } from "react"
import { ExtensionProvider } from "@/lib/extension-store"
import { ExtensionPopup } from "@/components/extension/extension-popup"
import { FloatingPermissionPrompt } from "@/components/extension/floating-permission-prompt"
import { Puzzle } from "lucide-react"

function DemoContent() {
  const [popupOpen, setPopupOpen] = useState(false)

  return (
    <div className="relative flex h-screen w-full flex-col overflow-hidden bg-background">
      {/* Simulated browser chrome bar */}
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-border bg-card px-4">
        <div className="flex items-center gap-2">
          <div className="flex gap-1.5">
            <div className="size-2.5 rounded-full bg-destructive/60" />
            <div className="size-2.5 rounded-full bg-warning/60" />
            <div className="size-2.5 rounded-full bg-success/60" />
          </div>
        </div>

        {/* URL bar */}
        <div className="flex h-6 max-w-md flex-1 items-center justify-center rounded-md bg-secondary px-3 mx-8">
          <span className="text-[11px] text-muted-foreground font-mono">
            https://chat.example.com
          </span>
        </div>

        {/* Extension icon */}
        <div className="relative">
          <button
            onClick={() => setPopupOpen(!popupOpen)}
            className={`flex items-center justify-center rounded-md p-1.5 transition-colors ${
              popupOpen
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-secondary hover:text-foreground"
            }`}
            aria-label="Toggle extension popup"
            aria-expanded={popupOpen}
          >
            <Puzzle className="size-4" />
            {/* Notification dot */}
            <div className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-warning animate-pulse" />
          </button>

          {/* Popup dropdown */}
          {popupOpen && (
            <div className="absolute right-0 top-[calc(100%+8px)] z-50 animate-in fade-in slide-in-from-top-2 duration-200">
              <ExtensionPopup />
            </div>
          )}
        </div>
      </div>

      {/* Simulated website content */}
      <div className="flex flex-1 items-center justify-center overflow-hidden">
        <div className="flex max-w-lg flex-col items-center gap-6 px-8 text-center">
          <div className="flex size-16 items-center justify-center rounded-2xl bg-secondary">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="size-8 text-muted-foreground">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          </div>
          <div className="flex flex-col gap-2">
            <h1 className="text-xl font-semibold text-foreground text-balance">
              Chat Example App
            </h1>
            <p className="text-sm text-muted-foreground leading-relaxed text-pretty">
              This simulated website is requesting access to AI models through
              the browser extension. Click the puzzle icon in the top-right to
              open the extension popup and manage permissions.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <div className="rounded-md border border-border bg-card px-3 py-1.5 text-[11px] text-muted-foreground font-mono">
              chat.example.com
            </div>
            <div className="rounded-md border border-dashed border-border px-3 py-1.5 text-[11px] text-muted-foreground">
              Requesting model access
            </div>
          </div>
        </div>
      </div>

      {/* Floating permission prompts */}
      <FloatingPermissionPrompt />
    </div>
  )
}

export default function ExtensionDemo() {
  return (
    <ExtensionProvider>
      <DemoContent />
    </ExtensionProvider>
  )
}

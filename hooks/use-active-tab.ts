import { useEffect, useMemo, useState } from "react"
import { browser } from "wxt/browser"

type ActiveTab = Awaited<ReturnType<typeof browser.tabs.query>>[number]

function tabUrlOrigin(url: string | undefined) {
  if (!url) return null

  try {
    const parsed = new URL(url)
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null
    }
    const origin = parsed.origin
    return origin === "null" ? null : origin
  } catch {
    return null
  }
}

export function useActiveTab() {
  const [tab, setTab] = useState<ActiveTab | null>(null)
  const [isPending, setIsPending] = useState(true)

  useEffect(() => {
    let alive = true

    const refresh = async () => {
      try {
        const [activeTab] = await browser.tabs.query({
          active: true,
          lastFocusedWindow: true,
        })

        if (!alive) return
        setTab(activeTab ?? null)
      } finally {
        if (alive) setIsPending(false)
      }
    }

    const onActivated: Parameters<typeof browser.tabs.onActivated.addListener>[0] = () => {
      void refresh()
    }

    const onUpdated: Parameters<typeof browser.tabs.onUpdated.addListener>[0] = (
      _tabId,
      changeInfo,
      tabInfo,
    ) => {
      if (!tabInfo.active) return
      if (changeInfo.url == null && changeInfo.status == null) return
      void refresh()
    }

    const onFocusChanged: Parameters<typeof browser.windows.onFocusChanged.addListener>[0] = () => {
      void refresh()
    }

    void refresh()
    browser.tabs.onActivated.addListener(onActivated)
    browser.tabs.onUpdated.addListener(onUpdated)
    browser.windows.onFocusChanged.addListener(onFocusChanged)

    return () => {
      alive = false
      browser.tabs.onActivated.removeListener(onActivated)
      browser.tabs.onUpdated.removeListener(onUpdated)
      browser.windows.onFocusChanged.removeListener(onFocusChanged)
    }
  }, [])

  const origin = useMemo(() => tabUrlOrigin(tab?.url), [tab?.url])

  return {
    tab,
    origin,
    isPending,
  }
}

import { browser } from "@wxt-dev/browser"

export type OAuthWebRequestOnBeforeRequest = NonNullable<
  NonNullable<typeof browser.webRequest>["onBeforeRequest"]
>

export type OAuthCallbackRequestListener = Parameters<OAuthWebRequestOnBeforeRequest["addListener"]>[0]
export type OAuthCallbackRequestDetails = Parameters<OAuthCallbackRequestListener>[0]

export type WaitForOAuthCallbackOptions = {
  urlPattern: string
  matchesUrl: (url: string) => boolean
  timeoutMs: number
  unsupportedErrorMessage: string
  timeoutErrorMessage: string
  registerListenerErrorPrefix: string
  signal?: AbortSignal
  onBeforeRequest?: OAuthWebRequestOnBeforeRequest
  onListenerArmed?: () => void
  onIntercepted?: (url: string) => void
}

function toErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message
  return String(error)
}

export async function waitForOAuthCallback(options: WaitForOAuthCallbackOptions) {
  const onBeforeRequest = options.onBeforeRequest ?? browser?.webRequest?.onBeforeRequest
  if (!onBeforeRequest) {
    throw new Error(options.unsupportedErrorMessage)
  }

  return await new Promise<string>((resolve, reject) => {
    let settled = false
    const timeoutId = setTimeout(() => {
      finalize(() => reject(new Error(options.timeoutErrorMessage)))
    }, options.timeoutMs)

    const listener: OAuthCallbackRequestListener = (details) => {
      if (details.type !== "main_frame") return undefined
      if (!options.matchesUrl(details.url)) return undefined

      options.onIntercepted?.(details.url)
      finalize(() => resolve(details.url))
      return undefined
    }

    const onAbort = () => {
      finalize(() => reject(new Error("Authentication canceled")))
    }

    const finalize = (action: () => void) => {
      if (settled) return
      settled = true

      clearTimeout(timeoutId)
      try {
        onBeforeRequest.removeListener(listener)
      } catch {
        // Ignore teardown errors while auth is ending.
      }
      options.signal?.removeEventListener("abort", onAbort)
      action()
    }

    try {
      onBeforeRequest.addListener(listener, {
        urls: [options.urlPattern],
        types: ["main_frame"],
      })
      options.onListenerArmed?.()
    } catch (error) {
      finalize(() =>
        reject(new Error(`${options.registerListenerErrorPrefix}: ${toErrorMessage(error)}`)),
      )
      return
    }

    if (options.signal?.aborted) {
      onAbort()
      return
    }
    options.signal?.addEventListener("abort", onAbort, { once: true })
  })
}

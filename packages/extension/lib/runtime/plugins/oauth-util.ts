export async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

function base64UrlEncodeBytes(bytes: Uint8Array) {
  let binary = ""
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

export function generateRandomString(length: number) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"
  const bytes = crypto.getRandomValues(new Uint8Array(length))
  return Array.from(bytes)
    .map((value) => chars[value % chars.length])
    .join("")
}

export async function generatePKCE() {
  const verifier = generateRandomString(64)
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))
  const challenge = base64UrlEncodeBytes(new Uint8Array(digest))
  return {
    verifier,
    challenge,
  }
}

export function generateState() {
  return base64UrlEncodeBytes(crypto.getRandomValues(new Uint8Array(32)))
}

export function normalizeDomain(url: string) {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "")
}

export function normalizeInstanceUrl(value: string) {
  const parsed = new URL(value.includes("://") ? value : `https://${value}`)
  return `${parsed.protocol}//${parsed.host}`
}

export function parseOAuthCallbackInput(input: { code?: string; callbackUrl?: string }) {
  const raw = input.callbackUrl?.trim() || input.code?.trim() || ""
  if (!raw) return { code: undefined, state: undefined }

  if (/^https?:\/\//i.test(raw)) {
    const parsed = new URL(raw)
    return {
      code: parsed.searchParams.get("code") ?? undefined,
      state: parsed.searchParams.get("state") ?? undefined,
    }
  }

  const queryCandidate = raw.startsWith("?") ? raw.slice(1) : raw
  if (queryCandidate.includes("=")) {
    const params = new URLSearchParams(queryCandidate)
    const code = params.get("code") ?? undefined
    const state = params.get("state") ?? undefined
    if (code || state) {
      return { code, state }
    }
  }

  return { code: raw, state: undefined }
}


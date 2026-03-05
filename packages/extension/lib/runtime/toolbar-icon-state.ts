export function tabUrlOrigin(url: string | undefined): string | null {
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

export function hasEnabledConnectedModel(input: {
  originEnabled: boolean
  allowedModelIds: ReadonlyArray<string>
  connectedModelIds: ReadonlySet<string>
}) {
  if (!input.originEnabled) return false
  if (input.allowedModelIds.length === 0) return false

  for (const modelId of input.allowedModelIds) {
    if (input.connectedModelIds.has(modelId)) {
      return true
    }
  }

  return false
}

export function isToolbarIconActive(input: {
  activeOrigin: string | null
  originEnabled: boolean
  allowedModelIds: ReadonlyArray<string>
  connectedModelIds: ReadonlySet<string>
}) {
  if (!input.activeOrigin) return false

  return hasEnabledConnectedModel({
    originEnabled: input.originEnabled,
    allowedModelIds: input.allowedModelIds,
    connectedModelIds: input.connectedModelIds,
  })
}

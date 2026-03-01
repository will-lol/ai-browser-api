export function now() {
  return Date.now()
}

export function randomId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}_${crypto.randomUUID()}`
  }
  return `${prefix}_${Math.random().toString(36).slice(2)}_${Date.now()}`
}

export function mergeRecord<T extends Record<string, unknown>>(base: T, patch?: Record<string, unknown>): T {
  if (!patch) return { ...base }
  const next: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue
    const current = next[key]
    if (isObject(current) && isObject(value)) {
      next[key] = mergeRecord(current as Record<string, unknown>, value)
      continue
    }
    next[key] = value
  }
  return next as T
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

export function parseProviderModel(model: string) {
  const [providerID, ...rest] = model.split("/")
  return {
    providerID,
    modelID: rest.join("/"),
  }
}

export function getModelCapabilities(modelID: string) {
  const lower = modelID.toLowerCase()
  const capabilities: string[] = ["text"]

  if (
    lower.includes("gpt-4") ||
    lower.includes("gpt-5") ||
    lower.includes("claude") ||
    lower.includes("gemini") ||
    lower.includes("vision")
  ) {
    capabilities.push("vision")
  }

  if (
    lower.includes("o1") ||
    lower.includes("o3") ||
    lower.includes("r1") ||
    lower.includes("reason") ||
    lower.includes("think")
  ) {
    capabilities.push("reasoning")
  }

  if (lower.includes("code") || lower.includes("coder") || lower.includes("gpt") || lower.includes("claude")) {
    capabilities.push("code")
  }

  return capabilities
}

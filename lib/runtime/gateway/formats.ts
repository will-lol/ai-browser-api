import type { ProviderModelInfo } from "@/lib/runtime/provider-registry"

export type ProviderFormat = "openai" | "oa-compat" | "anthropic" | "google"

export function getProviderFormat(model: ProviderModelInfo): ProviderFormat {
  if (model.api.npm === "@ai-sdk/openai" || model.api.npm === "@ai-sdk/azure") return "openai"
  if (model.api.npm === "@ai-sdk/anthropic" || model.api.npm === "@ai-sdk/google-vertex/anthropic") return "anthropic"
  if (model.api.npm === "@ai-sdk/google" || model.api.npm === "@ai-sdk/google-vertex") return "google"
  return "oa-compat"
}

export function buildEndpoint(
  model: ProviderModelInfo,
  format: ProviderFormat,
  isStream: boolean,
  baseURL?: string,
) {
  const base = (baseURL ?? model.api.url).replace(/\/$/, "")

  if (format === "openai") {
    return `${base}/responses`
  }

  if (format === "anthropic") {
    return `${base}/messages`
  }

  if (format === "google") {
    const suffix = isStream ? ":streamGenerateContent?alt=sse" : ":generateContent"
    return `${base}/models/${model.api.id}${suffix}`
  }

  return `${base}/chat/completions`
}

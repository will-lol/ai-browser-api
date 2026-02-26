export const PROVIDER_LABELS: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google AI",
  mistral: "Mistral",
  meta: "Meta",
  cohere: "Cohere",
  xai: "xAI",
  deepseek: "DeepSeek",
  perplexity: "Perplexity",
}

export function getProviderLabel(providerId: string) {
  return PROVIDER_LABELS[providerId] ?? providerId
}

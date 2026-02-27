export type PermissionStatus = "allowed" | "denied" | "pending"

export interface ModelPermission {
  modelId: string
  modelName: string
  provider: string
  status: PermissionStatus
  capabilities: string[]
  requestedAt?: number
}

export interface Provider {
  id: string
  name: string
  connected: boolean
  models: string[]
  icon: string // Emoji-free, we'll use initials
}

export interface PermissionRequest {
  id: string
  origin: string
  modelId: string
  modelName: string
  provider: string
  capabilities: string[]
  requestedAt: number
  dismissed: boolean
}

export const PROVIDERS: Provider[] = [
  {
    id: "openai",
    name: "OpenAI",
    connected: true,
    icon: "OA",
    models: [
      "gpt-4o",
      "gpt-4o-mini",
      "gpt-4-turbo",
      "gpt-4",
      "gpt-3.5-turbo",
      "o1",
      "o1-mini",
      "o1-pro",
      "o3-mini",
      "dall-e-3",
    ],
  },
  {
    id: "anthropic",
    name: "Anthropic",
    connected: true,
    icon: "AN",
    models: [
      "claude-opus-4",
      "claude-sonnet-4",
      "claude-3.5-sonnet",
      "claude-3.5-haiku",
      "claude-3-opus",
      "claude-3-haiku",
    ],
  },
  {
    id: "google",
    name: "Google AI",
    connected: true,
    icon: "GO",
    models: [
      "gemini-2.5-pro",
      "gemini-2.5-flash",
      "gemini-2.0-flash",
      "gemini-1.5-pro",
      "gemini-1.5-flash",
    ],
  },
  {
    id: "mistral",
    name: "Mistral",
    connected: false,
    icon: "MI",
    models: [
      "mistral-large",
      "mistral-medium",
      "mistral-small",
      "codestral",
      "mixtral-8x22b",
    ],
  },
  {
    id: "meta",
    name: "Meta (via Groq)",
    connected: false,
    icon: "ME",
    models: ["llama-3.3-70b", "llama-3.1-405b", "llama-3.1-70b", "llama-3.1-8b"],
  },
  {
    id: "cohere",
    name: "Cohere",
    connected: false,
    icon: "CO",
    models: ["command-r-plus", "command-r", "command-light"],
  },
  {
    id: "xai",
    name: "xAI",
    connected: false,
    icon: "XA",
    models: ["grok-2", "grok-2-mini"],
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    connected: false,
    icon: "DS",
    models: ["deepseek-v3", "deepseek-r1", "deepseek-coder"],
  },
  {
    id: "perplexity",
    name: "Perplexity",
    connected: false,
    icon: "PX",
    models: ["sonar-pro", "sonar", "sonar-reasoning"],
  },
]

export function getCapabilitiesForModel(modelName: string): string[] {
  const lower = modelName.toLowerCase()
  const caps: string[] = ["text"]

  if (
    lower.includes("gpt-4") ||
    lower.includes("claude-opus") ||
    lower.includes("claude-sonnet") ||
    lower.includes("gemini") ||
    lower.includes("grok-2") && !lower.includes("mini")
  ) {
    caps.push("vision")
  }

  if (lower.includes("dall-e")) {
    return ["image-generation"]
  }

  if (
    lower.includes("o1") ||
    lower.includes("o3") ||
    lower.includes("r1") ||
    lower.includes("reasoning")
  ) {
    caps.push("reasoning")
  }

  if (
    lower.includes("code") ||
    lower.includes("gpt-4") ||
    lower.includes("claude")
  ) {
    caps.push("code")
  }

  return caps
}

// Permissions for "chat.example.com"
export const INITIAL_PERMISSIONS: ModelPermission[] = [
  {
    modelId: "openai/gpt-4o",
    modelName: "gpt-4o",
    provider: "openai",
    status: "allowed",
    capabilities: ["text", "vision", "code"],
  },
  {
    modelId: "openai/gpt-4o-mini",
    modelName: "gpt-4o-mini",
    provider: "openai",
    status: "allowed",
    capabilities: ["text", "vision", "code"],
  },
  {
    modelId: "anthropic/claude-sonnet-4",
    modelName: "claude-sonnet-4",
    provider: "anthropic",
    status: "denied",
    capabilities: ["text", "vision", "code"],
  },
]

export const INITIAL_PENDING_REQUESTS: PermissionRequest[] = []

export const CURRENT_ORIGIN = "chat.example.com"

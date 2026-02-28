import { isObject } from "@/lib/runtime/util"

function isMessage(value: unknown): value is Record<string, unknown> {
  return isObject(value)
}

function toGooglePart(part: unknown) {
  if (!isObject(part)) return undefined
  if (part.type === "text") {
    return { text: typeof part.text === "string" ? part.text : "" }
  }
  if (part.type === "image_url" && isObject(part.image_url) && typeof part.image_url.url === "string") {
    const match = part.image_url.url.match(/^data:([^;]+);base64,(.*)$/)
    if (!match) return undefined
    return {
      inlineData: {
        mimeType: match[1],
        data: match[2],
      },
    }
  }
  return undefined
}

export function toGoogleRequest(body: Record<string, unknown>) {
  const messages = Array.isArray(body.messages) ? body.messages : []
  const contents = messages
    .filter((message): message is Record<string, unknown> => isMessage(message) && message.role !== "system")
    .map((message) => ({
      role: message.role === "assistant" ? "model" : "user",
      parts:
        typeof message.content === "string"
          ? [{ text: message.content }]
          : Array.isArray(message.content)
            ? message.content.map(toGooglePart).filter((item): item is NonNullable<typeof item> => !!item)
            : [{ text: "" }],
    }))

  const rawGenerationConfig = isObject(body.generationConfig) ? body.generationConfig : {}
  const thinkingConfig = isObject(body.thinkingConfig) ? { thinkingConfig: body.thinkingConfig } : {}
  const extras = Object.fromEntries(
    Object.entries(body).filter(
      ([key, value]) =>
        !["messages", "generationConfig", "thinkingConfig", "temperature", "top_p", "max_tokens"].includes(key) &&
        value !== undefined,
    ),
  )

  return {
    ...extras,
    contents,
    generationConfig: {
      ...rawGenerationConfig,
      ...thinkingConfig,
      temperature: body.temperature ?? rawGenerationConfig.temperature,
      topP: body.top_p ?? rawGenerationConfig.topP,
      maxOutputTokens: body.max_tokens ?? rawGenerationConfig.maxOutputTokens,
    },
  }
}

export function fromGoogleResponse(json: Record<string, unknown>) {
  const candidates = Array.isArray(json.candidates) ? json.candidates : []
  const first = isObject(candidates[0]) ? candidates[0] : undefined
  const firstContent = first && isObject(first.content) ? first.content : undefined
  const parts = Array.isArray(firstContent?.parts) ? firstContent.parts : []
  const text = Array.isArray(parts)
    ? parts
        .filter((part): part is { text: string } => isObject(part) && typeof part.text === "string")
        .map((part) => part.text)
        .join("")
    : ""

  const usage = isObject(json.usageMetadata) ? json.usageMetadata : undefined
  const promptTokens = usage && typeof usage.promptTokenCount === "number" ? usage.promptTokenCount : undefined
  const completionTokens = usage && typeof usage.candidatesTokenCount === "number" ? usage.candidatesTokenCount : undefined
  const totalTokens = usage && typeof usage.totalTokenCount === "number" ? usage.totalTokenCount : undefined

  return {
    id: `google_${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: typeof json.modelVersion === "string" ? json.modelVersion : undefined,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: text,
        },
        finish_reason:
          first && typeof first.finishReason === "string" ? first.finishReason.toLowerCase() : "stop",
      },
    ],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: totalTokens,
    },
    _raw: json,
  }
}

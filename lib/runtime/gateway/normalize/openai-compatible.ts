import { isObject } from "@/lib/runtime/util"

interface OpenAICompatibleMessage {
  role: string
  content: string | Array<Record<string, unknown>>
}

function normalizeMessage(message: unknown): OpenAICompatibleMessage | undefined {
  if (!isObject(message)) return undefined
  if (typeof message.role !== "string") return undefined

  if (typeof message.content === "string") {
    return { role: message.role, content: message.content }
  }

  if (Array.isArray(message.content)) {
    return {
      role: message.role,
      content: message.content.filter((part): part is Record<string, unknown> => isObject(part)),
    }
  }

  return { role: message.role, content: "" }
}

export function toOpenAICompatibleRequest(body: Record<string, unknown>) {
  const messages = Array.isArray(body.messages)
    ? body.messages.map(normalizeMessage).filter((item): item is OpenAICompatibleMessage => !!item)
    : []

  const extras = Object.fromEntries(
    Object.entries(body).filter(
      ([key, value]) =>
        ![
          "model",
          "messages",
          "stream",
          "max_tokens",
          "temperature",
          "top_p",
          "tools",
          "tool_choice",
          "stop",
          "response_format",
          "stream_options",
        ].includes(key) && value !== undefined,
    ),
  )

  return {
    ...extras,
    model: body.model,
    messages,
    stream: Boolean(body.stream),
    max_tokens: body.max_tokens,
    temperature: body.temperature,
    top_p: body.top_p,
    tools: Array.isArray(body.tools) ? body.tools : undefined,
    tool_choice: body.tool_choice,
    stop: body.stop,
    response_format: body.response_format,
    stream_options: body.stream ? { include_usage: true } : undefined,
  }
}

export function fromOpenAICompatibleResponse(json: Record<string, unknown>) {
  return json
}

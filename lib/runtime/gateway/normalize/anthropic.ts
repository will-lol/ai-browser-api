import { isObject } from "@/lib/runtime/util"

type AnthropicTextPart = { type: "text"; text: string }
type AnthropicImagePart = {
  type: "image"
  source: {
    type: "base64"
    media_type: string
    data: string
  }
}

type AnthropicContentPart = AnthropicTextPart | AnthropicImagePart

interface AnthropicMessage {
  role: "user" | "assistant"
  content: AnthropicContentPart[]
}

function toAnthropicMessage(message: unknown): AnthropicMessage | undefined {
  if (!isObject(message)) return undefined
  if (message.role !== "user" && message.role !== "assistant") return undefined

  if (typeof message.content === "string") {
    return {
      role: message.role,
      content: [{ type: "text", text: message.content }],
    }
  }

  if (Array.isArray(message.content)) {
    const content = message.content.map((part): AnthropicContentPart => {
      if (isObject(part) && part.type === "text") {
        return { type: "text", text: typeof part.text === "string" ? part.text : "" }
      }
      if (
        isObject(part) &&
        part.type === "image_url" &&
        isObject(part.image_url) &&
        typeof part.image_url.url === "string"
      ) {
        const source = part.image_url.url
        if (source.startsWith("data:")) {
          const match = source.match(/^data:([^;]+);base64,(.*)$/)
          if (match) {
            return {
              type: "image",
              source: {
                type: "base64",
                media_type: match[1],
                data: match[2],
              },
            }
          }
        }
      }
      return {
        type: "text",
        text: "",
      }
    })

    return {
      role: message.role,
      content,
    }
  }

  return {
    role: message.role,
    content: [{ type: "text", text: "" }],
  }
}

function toAnthropicTool(tool: unknown) {
  if (!isObject(tool) || !isObject(tool.function) || typeof tool.function.name !== "string") return undefined
  return {
    name: tool.function.name,
    description: typeof tool.function.description === "string" ? tool.function.description : undefined,
    input_schema: isObject(tool.function.parameters) ? tool.function.parameters : undefined,
  }
}

export function toAnthropicRequest(body: Record<string, unknown>) {
  const raw = Array.isArray(body.messages) ? body.messages : []
  const system = raw
    .filter((message): message is { role: "system"; content: string } =>
      isObject(message) && message.role === "system" && typeof message.content === "string",
    )
    .map((message) => message.content)
    .join("\n")

  const messages = raw.map(toAnthropicMessage).filter((item): item is AnthropicMessage => !!item)

  const extras = Object.fromEntries(
    Object.entries(body).filter(
      ([key, value]) =>
        !["messages", "model", "stream", "max_tokens", "temperature", "top_p", "tool_choice", "tools"].includes(key) &&
        value !== undefined,
    ),
  )

  return {
    ...extras,
    model: body.model,
    messages,
    system,
    stream: Boolean(body.stream),
    max_tokens: body.max_tokens ?? 4096,
    temperature: body.temperature,
    top_p: body.top_p,
    tool_choice: body.tool_choice,
    tools: Array.isArray(body.tools)
      ? body.tools.map(toAnthropicTool).filter((tool): tool is NonNullable<typeof tool> => !!tool)
      : undefined,
  }
}

export function fromAnthropicResponse(json: Record<string, unknown>) {
  const content = Array.isArray(json.content) ? json.content : []
  const text = content
    .filter((part): part is { type: "text"; text: string } => isObject(part) && part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("")

  const usage = isObject(json.usage) ? json.usage : undefined
  const prompt = usage && typeof usage.input_tokens === "number" ? usage.input_tokens : undefined
  const completion = usage && typeof usage.output_tokens === "number" ? usage.output_tokens : undefined

  return {
    id: json.id,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: json.model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: text,
        },
        finish_reason: json.stop_reason ?? "stop",
      },
    ],
    usage: {
      prompt_tokens: prompt,
      completion_tokens: completion,
      total_tokens: (prompt ?? 0) + (completion ?? 0),
    },
    _raw: json,
  }
}

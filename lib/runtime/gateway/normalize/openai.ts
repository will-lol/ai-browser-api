import { isObject } from "@/lib/runtime/util"

type OpenAIResponsesUserContentPart =
  | {
      type: "input_text"
      text: string
    }
  | {
      type: "input_image"
      image_url: string | Record<string, unknown>
    }

function mapUserContent(content: unknown) {
  if (typeof content === "string") {
    return [{ type: "input_text", text: content }]
  }

  if (!Array.isArray(content)) {
    return [{ type: "input_text", text: "" }]
  }

  const parts: OpenAIResponsesUserContentPart[] = []
  for (const part of content) {
    if (!isObject(part)) continue
    if (part.type === "text" && typeof part.text === "string") {
      parts.push({ type: "input_text", text: part.text })
      continue
    }
    if (
      part.type === "image_url" &&
      (typeof part.image_url === "string" || isObject(part.image_url))
    ) {
      parts.push({ type: "input_image", image_url: part.image_url })
      continue
    }
  }

  if (parts.length === 0) {
    parts.push({ type: "input_text", text: "" })
  }

  return parts
}

export function toOpenAIResponsesRequest(body: Record<string, unknown>) {
  const items: Array<Record<string, unknown>> = []
  const messages = Array.isArray(body.messages) ? body.messages : []

  for (const message of messages) {
    if (!isObject(message)) continue
    if (message.role === "system") {
      items.push({ role: "system", content: typeof message.content === "string" ? message.content : "" })
      continue
    }

    if (message.role === "user") {
      items.push({
        role: "user",
        content: mapUserContent(message.content),
      })
      continue
    }

    if (message.role === "assistant") {
      items.push({
        role: "assistant",
        content: typeof message.content === "string" ? message.content : "",
      })
      continue
    }
  }

  const extras = Object.fromEntries(
    Object.entries(body).filter(
      ([key, value]) =>
        !["messages", "model", "stream", "temperature", "max_tokens", "top_p", "tools", "tool_choice", "include"].includes(key) &&
        value !== undefined,
    ),
  )

  return {
    ...extras,
    model: body.model,
    input: items,
    stream: Boolean(body.stream),
    temperature: body.temperature,
    max_output_tokens: body.max_tokens,
    top_p: body.top_p,
    tools: Array.isArray(body.tools) ? body.tools : undefined,
    tool_choice: body.tool_choice,
    include: Array.isArray(body.include) ? body.include : ["reasoning.encrypted_content"],
  }
}

export function fromOpenAIResponsesResponse(json: Record<string, unknown>) {
  if (!Array.isArray(json.output)) return json

  const text = json.output
    .filter((item): item is { type: "message"; content: unknown[] } =>
      isObject(item) && item.type === "message" && Array.isArray(item.content),
    )
    .flatMap((item) => item.content)
    .filter((part): part is { type: "output_text"; text: string } =>
      isObject(part) && part.type === "output_text" && typeof part.text === "string",
    )
    .map((part) => part.text)
    .join("")

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
        finish_reason: "stop",
      },
    ],
    usage: json.usage,
    _raw: json,
  }
}

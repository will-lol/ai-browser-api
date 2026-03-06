import assert from "node:assert/strict"
import { describe, it } from "node:test"
import type {
  JSONValue,
  JSONObject,
  LanguageModelV3CallOptions,
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamPart,
} from "@ai-sdk/provider"
import {
  encodeRuntimeWireValue,
  type RuntimeModelCallOptions,
} from "@llm-bridge/contracts"
import {
  fromRuntimeGenerateResponse,
  fromRuntimeModelCallOptions,
  fromRuntimeStreamPart,
  toRuntimeGenerateResponse,
  toRuntimeModelCallOptions,
  toRuntimeStreamPart,
} from "./index"

function toJsonObject(value: Record<string, unknown>): JSONObject {
  return value as unknown as JSONObject
}

function toJsonValue(value: unknown): JSONValue {
  return value as JSONValue
}

function sanitize(value: unknown): unknown {
  if (value instanceof URL) {
    return {
      __type: "url",
      href: value.toString(),
    }
  }

  if (value instanceof Uint8Array) {
    return {
      __type: "uint8array",
      data: Array.from(value),
    }
  }

  if (value instanceof Date) {
    return {
      __type: "date",
      iso: value.toISOString(),
    }
  }

  if (value instanceof Error) {
    return {
      __type: "error",
      name: value.name,
      message: value.message,
    }
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sanitize(entry))
  }

  if (typeof value === "object" && value !== null) {
    const output: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value)) {
      if (entry === undefined) continue
      output[key] = sanitize(entry)
    }
    return output
  }

  return value
}

type ProviderCallOptionsRoundtrip = Omit<LanguageModelV3CallOptions, "abortSignal">
type ProviderAssistantMessage = Extract<
  ProviderCallOptionsRoundtrip["prompt"][number],
  { role: "assistant" }
>
type ProviderAssistantToolCallPart = Extract<
  ProviderAssistantMessage["content"][number],
  { type: "tool-call" }
>
type ProviderFunctionTool = Extract<
  NonNullable<ProviderCallOptionsRoundtrip["tools"]>[number],
  { type: "function" }
>
type ProviderAssistantContentToolResultPart = Extract<
  ProviderAssistantMessage["content"][number],
  { type: "tool-result" }
> & {
  output: Extract<
    Extract<ProviderAssistantMessage["content"][number], { type: "tool-result" }>["output"],
    { type: "content" }
  >
}
type FinishStreamPart = Extract<LanguageModelV3StreamPart, { type: "finish" }>

const providerCallOptions = {
  prompt: [
    {
      role: "system",
      content: "system prompt",
      providerOptions: {
        openai: toJsonObject({
          cache: "on",
          drop: undefined,
        }),
      },
    },
    {
      role: "user",
      content: [
        {
          type: "text",
          text: "hello",
        },
        {
          type: "file",
          filename: "inline.txt",
          data: "inline-file",
          mediaType: "text/plain",
        },
        {
          type: "file",
          filename: "remote.txt",
          data: new URL("https://example.test/file.txt"),
          mediaType: "text/plain",
        },
        {
          type: "file",
          filename: "binary.bin",
          data: new Uint8Array([1, 2, 3]),
          mediaType: "application/octet-stream",
        },
      ],
    },
    {
      role: "assistant",
      content: [
        {
          type: "text",
          text: "assistant text",
        },
        {
          type: "file",
          filename: "assistant.txt",
          data: "assistant-file",
          mediaType: "text/plain",
        },
        {
          type: "reasoning",
          text: "assistant reasoning",
        },
        {
          type: "tool-call",
          toolCallId: "tool-call-1",
          toolName: "lookup",
          input: {
            keep: true,
            optional: undefined,
          },
          providerExecuted: true,
        },
        {
          type: "tool-result",
          toolCallId: "tool-call-1",
          toolName: "lookup",
          output: {
            type: "text",
            value: "result text",
          },
        },
        {
          type: "tool-result",
          toolCallId: "tool-call-2",
          toolName: "lookup",
          output: {
            type: "json",
            value: toJsonValue({
              ok: true,
              drop: undefined,
            }),
          },
        },
        {
          type: "tool-result",
          toolCallId: "tool-call-3",
          toolName: "lookup",
          output: {
            type: "execution-denied",
            reason: "no permission",
          },
        },
        {
          type: "tool-result",
          toolCallId: "tool-call-4",
          toolName: "lookup",
          output: {
            type: "error-text",
            value: "error text",
          },
        },
        {
          type: "tool-result",
          toolCallId: "tool-call-5",
          toolName: "lookup",
          output: {
            type: "error-json",
            value: toJsonValue({
              code: "E_TOOL",
              drop: undefined,
            }),
          },
        },
        {
          type: "tool-result",
          toolCallId: "tool-call-6",
          toolName: "lookup",
          output: {
            type: "content",
            value: [
              {
                type: "text",
                text: "content text",
              },
              {
                type: "file-data",
                data: "ZGF0YQ==",
                mediaType: "text/plain",
                filename: "content.txt",
              },
              {
                type: "file-url",
                url: "https://example.test/content.txt",
              },
              {
                type: "file-id",
                fileId: "file_123",
              },
              {
                type: "image-data",
                data: "aW1hZ2U=",
                mediaType: "image/png",
              },
              {
                type: "image-url",
                url: "https://example.test/image.png",
              },
              {
                type: "image-file-id",
                fileId: {
                  provider: "openai",
                  id: "img_123",
                },
              },
              {
                type: "custom",
                providerOptions: {
                  openai: toJsonObject({
                    keep: "part",
                    drop: undefined,
                  }),
                },
              },
            ],
          },
        },
      ],
    },
    {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "tool-call-7",
          toolName: "lookup",
          output: {
            type: "text",
            value: "tool role result",
          },
        },
        {
          type: "tool-approval-response",
          approvalId: "approval-1",
          approved: false,
          reason: "denied",
        },
      ],
    },
  ],
  maxOutputTokens: 321,
  temperature: 0.7,
  stopSequences: ["END"],
  topP: 0.9,
  topK: 20,
  presencePenalty: 0.1,
  frequencyPenalty: 0.2,
  responseFormat: {
    type: "json",
    schema: {
      type: "object",
      optional: undefined,
    },
    name: "response_schema",
    description: "JSON schema",
  },
  seed: 42,
  tools: [
    {
      type: "function",
      name: "lookup",
      description: "Lookup data",
      inputSchema: {
        type: "object",
        properties: {
          value: {
            type: "string",
          },
        },
        optional: undefined,
      },
      inputExamples: [
        {
          input: toJsonObject({
            value: "sample",
            drop: undefined,
          }),
        },
      ],
      strict: true,
      providerOptions: {
        openai: toJsonObject({
          keep: "tool",
          drop: undefined,
        }),
      },
    },
    {
      type: "provider",
      id: "vendor.lookup",
      name: "vendor lookup",
      args: {
        url: new URL("https://example.test/provider-tool"),
        bytes: new Uint8Array([9, 8, 7]),
        missing: undefined,
        error: new TypeError("provider failure"),
      },
    },
  ],
  toolChoice: {
    type: "tool",
    toolName: "lookup",
  },
  includeRawChunks: true,
  headers: {
    authorization: "Bearer token",
    drop: undefined,
  },
  providerOptions: {
    openai: toJsonObject({
      keep: "present",
      nested: {
        on: true,
        off: undefined,
      },
    }),
  },
} as unknown as LanguageModelV3CallOptions
const providerPromptMessages = providerCallOptions.prompt as ProviderCallOptionsRoundtrip["prompt"]
const providerAssistantMessage = providerPromptMessages[2] as ProviderAssistantMessage
const providerAssistantContentToolResult = providerAssistantMessage.content[9] as ProviderAssistantContentToolResultPart
const providerTools = providerCallOptions.tools as NonNullable<ProviderCallOptionsRoundtrip["tools"]>
const providerFunctionTool = providerTools[0] as ProviderFunctionTool

const normalizedProviderCallOptions = {
  ...providerCallOptions,
  prompt: [
    {
      ...providerPromptMessages[0],
      providerOptions: {
        openai: toJsonObject({
          cache: "on",
        }),
      },
    },
    providerPromptMessages[1],
    {
      ...providerAssistantMessage,
      content: [
        providerAssistantMessage.content[0],
        providerAssistantMessage.content[1],
        providerAssistantMessage.content[2],
        providerAssistantMessage.content[3],
        providerAssistantMessage.content[4],
        {
          ...providerAssistantMessage.content[5],
          output: {
            type: "json",
            value: toJsonValue({
              ok: true,
            }),
          },
        },
        providerAssistantMessage.content[6],
        providerAssistantMessage.content[7],
        {
          ...providerAssistantMessage.content[8],
          output: {
            type: "error-json",
            value: toJsonValue({
              code: "E_TOOL",
            }),
          },
        },
        {
          ...providerAssistantMessage.content[9],
          output: {
            type: "content",
            value: [
              providerAssistantContentToolResult.output.value[0],
              providerAssistantContentToolResult.output.value[1],
              providerAssistantContentToolResult.output.value[2],
              providerAssistantContentToolResult.output.value[3],
              providerAssistantContentToolResult.output.value[4],
              providerAssistantContentToolResult.output.value[5],
              providerAssistantContentToolResult.output.value[6],
              {
                type: "custom",
                providerOptions: {
                  openai: toJsonObject({
                    keep: "part",
                  }),
                },
              },
            ],
          },
        },
      ],
    },
    providerPromptMessages[3],
  ],
  tools: [
    {
      ...providerFunctionTool,
      inputExamples: [
        {
          input: toJsonObject({
            value: "sample",
          }),
        },
      ],
      providerOptions: {
        openai: toJsonObject({
          keep: "tool",
        }),
      },
    },
    providerTools[1],
  ],
  headers: {
    authorization: "Bearer token",
  },
  providerOptions: {
    openai: toJsonObject({
      keep: "present",
      nested: {
        on: true,
      },
    }),
  },
} as unknown as Omit<LanguageModelV3CallOptions, "abortSignal">

const runtimeCallOptions = {
  prompt: [
    {
      role: "system",
      content: "runtime prompt",
    },
  ],
  tools: [
    {
      type: "provider",
      id: "lookup",
      name: "runtime provider tool",
      args: {
        query: encodeRuntimeWireValue({
          term: "search",
        }),
      },
    },
  ],
  responseFormat: {
    type: "text",
  },
} satisfies RuntimeModelCallOptions

const generateResult = {
  content: [
    {
      type: "text",
      text: "generated text",
      providerMetadata: {
        openai: toJsonObject({
          message: "text",
          drop: undefined,
        }),
      },
    },
    {
      type: "reasoning",
      text: "generated reasoning",
    },
    {
      type: "file",
      mediaType: "text/plain",
      data: "plain-file",
    },
    {
      type: "file",
      mediaType: "application/octet-stream",
      data: new Uint8Array([5, 6, 7]),
    },
    {
      type: "tool-approval-request",
      approvalId: "approval-2",
      toolCallId: "tool-call-8",
    },
    {
      type: "source",
      sourceType: "url",
      id: "source-url",
      url: "https://example.test/source",
      title: "URL source",
    },
    {
      type: "source",
      sourceType: "document",
      id: "source-doc",
      mediaType: "application/pdf",
      title: "Document source",
      filename: "source.pdf",
    },
    {
      type: "tool-call",
      toolCallId: "tool-call-9",
      toolName: "lookup",
      input: "{\"query\":\"value\"}",
      providerExecuted: true,
      dynamic: true,
    },
    {
      type: "tool-result",
      toolCallId: "tool-call-9",
      toolName: "lookup",
      result: null,
      isError: false,
      preliminary: true,
      dynamic: true,
    },
  ],
  finishReason: {
    unified: "tool-calls",
    raw: "provider-finish",
  },
  usage: {
    inputTokens: {
      total: 12,
      noCache: 10,
      cacheRead: 1,
      cacheWrite: 1,
    },
    outputTokens: {
      total: 34,
      text: 20,
      reasoning: 14,
    },
    raw: toJsonObject({
      measured: true,
      drop: undefined,
    }),
  },
  providerMetadata: {
    openai: toJsonObject({
      request: "metadata",
      drop: undefined,
    }),
  },
  request: {
    body: {
      url: new URL("https://example.test/request"),
      bytes: new Uint8Array([1, 4, 9]),
      when: new Date("2025-01-02T03:04:05.000Z"),
      error: new Error("request failure"),
      optional: undefined,
    },
  },
  response: {
    id: "response-1",
    timestamp: new Date("2025-02-03T04:05:06.000Z"),
    modelId: "openai/gpt-4o-mini",
    headers: {
      "x-test": "header",
    },
    body: {
      acknowledged: true,
      optional: undefined,
    },
  },
  warnings: [
    {
      type: "unsupported",
      feature: "feature-a",
      details: "warning details",
    },
    {
      type: "other",
      message: "other warning",
    },
  ],
} as unknown as LanguageModelV3GenerateResult

const normalizedGenerateResult = {
  ...generateResult,
  content: [
    {
      ...generateResult.content[0],
      providerMetadata: {
        openai: toJsonObject({
          message: "text",
        }),
      },
    },
    ...generateResult.content.slice(1, 8),
    {
      ...generateResult.content[8],
      result: {},
    },
  ],
  usage: {
    ...generateResult.usage,
    raw: toJsonObject({
      measured: true,
    }),
  },
  providerMetadata: {
    openai: toJsonObject({
      request: "metadata",
    }),
  },
} as unknown as LanguageModelV3GenerateResult

const streamParts = [
  {
    type: "text-start",
    id: "text-1",
    providerMetadata: {
      openai: toJsonObject({
        keep: "text-start",
        drop: undefined,
      }),
    },
  },
  {
    type: "text-delta",
    id: "text-1",
    delta: "hello",
  },
  {
    type: "text-end",
    id: "text-1",
  },
  {
    type: "reasoning-start",
    id: "reasoning-1",
  },
  {
    type: "reasoning-delta",
    id: "reasoning-1",
    delta: "thinking",
  },
  {
    type: "reasoning-end",
    id: "reasoning-1",
  },
  {
    type: "tool-input-start",
    id: "tool-1",
    toolName: "lookup",
    providerExecuted: true,
    dynamic: true,
    title: "Tool title",
  },
  {
    type: "tool-input-delta",
    id: "tool-1",
    delta: "{\"query\":\"value\"}",
  },
  {
    type: "tool-input-end",
    id: "tool-1",
  },
  {
    type: "tool-approval-request",
    approvalId: "approval-3",
    toolCallId: "tool-call-10",
  },
  {
    type: "tool-call",
    toolCallId: "tool-call-10",
    toolName: "lookup",
    input: "{\"query\":\"value\"}",
    providerExecuted: true,
    dynamic: true,
  },
  {
    type: "tool-result",
    toolCallId: "tool-call-10",
    toolName: "lookup",
    result: null,
    isError: false,
    preliminary: true,
    dynamic: true,
  },
  {
    type: "file",
    mediaType: "text/plain",
    data: "stream-file",
  },
  {
    type: "file",
    mediaType: "application/octet-stream",
    data: new Uint8Array([7, 8, 9]),
  },
  {
    type: "source",
    sourceType: "url",
    id: "stream-source-url",
    url: "https://example.test/stream-source",
    title: "Stream URL",
  },
  {
    type: "source",
    sourceType: "document",
    id: "stream-source-doc",
    mediaType: "application/pdf",
    title: "Stream document",
    filename: "stream.pdf",
  },
  {
    type: "stream-start",
    warnings: [
      {
        type: "compatibility",
        feature: "feature-b",
        details: "compat details",
      },
      {
        type: "other",
        message: "stream warning",
      },
    ],
  },
  {
    type: "response-metadata",
    id: "response-2",
    timestamp: new Date("2025-03-04T05:06:07.000Z"),
    modelId: "openai/gpt-4o-mini",
  },
  {
    type: "finish",
    finishReason: {
      unified: "stop",
      raw: "done",
    },
    usage: {
      inputTokens: {
        total: 1,
      },
      outputTokens: {
        total: 2,
        text: 1,
        reasoning: 1,
      },
      raw: toJsonObject({
        keep: true,
        drop: undefined,
      }),
    },
    providerMetadata: {
      openai: toJsonObject({
        keep: "finish",
        drop: undefined,
      }),
    },
  },
  {
    type: "raw",
    rawValue: {
      url: new URL("https://example.test/raw"),
      bytes: new Uint8Array([4, 2]),
      error: new Error("raw error"),
      optional: undefined,
    },
  },
  {
    type: "error",
    error: new TypeError("stream error"),
  },
] as unknown as Array<LanguageModelV3StreamPart>
const finishStreamPart = streamParts[18] as FinishStreamPart

const normalizedStreamParts = [
  {
    ...streamParts[0],
    providerMetadata: {
      openai: toJsonObject({
        keep: "text-start",
      }),
    },
  },
  ...streamParts.slice(1, 11),
  {
    ...streamParts[11],
    result: {},
  },
  ...streamParts.slice(12, 18),
  {
    ...finishStreamPart,
    usage: {
      ...finishStreamPart.usage,
      raw: toJsonObject({
        keep: true,
      }),
    },
    providerMetadata: {
      openai: toJsonObject({
        keep: "finish",
      }),
    },
  },
  ...streamParts.slice(19),
] as unknown as Array<LanguageModelV3StreamPart>

describe("bridge codecs", () => {
  it("roundtrips provider call options and preserves expected normalization", () => {
    const roundtrip = fromRuntimeModelCallOptions(
      toRuntimeModelCallOptions(providerCallOptions),
    )

    assert.deepEqual(sanitize(roundtrip), sanitize(normalizedProviderCallOptions))
    assert.deepEqual(roundtrip.headers, {
      authorization: "Bearer token",
    })
    assert.deepEqual(roundtrip.providerOptions, {
      openai: toJsonObject({
        keep: "present",
        nested: {
          on: true,
        },
      }),
    })
    assert.deepEqual(roundtrip.prompt[0]?.providerOptions, {
      openai: toJsonObject({
        cache: "on",
      }),
    })
    const functionTool = roundtrip.tools?.[0]
    assert.equal(functionTool?.type, "function")
    if (functionTool?.type === "function") {
      assert.deepEqual(functionTool.inputExamples, [
        {
          input: toJsonObject({
            value: "sample",
          }),
        },
      ])
    }

    const assistantMessage = roundtrip.prompt[2] as ProviderAssistantMessage
    assert.deepEqual(assistantMessage?.content[5], {
      type: "tool-result",
      toolCallId: "tool-call-2",
      toolName: "lookup",
      output: {
        type: "json",
        value: toJsonValue({
          ok: true,
        }),
        providerOptions: undefined,
      },
      providerOptions: undefined,
    })
    const toolCallInput = assistantMessage?.content[3] as ProviderAssistantToolCallPart | undefined
    assert.equal(toolCallInput?.type, "tool-call")
    if (toolCallInput?.type === "tool-call") {
      const toolCallInputValue = toolCallInput.input as Record<string, unknown>
      assert.equal("optional" in toolCallInputValue, true)
      assert.equal(toolCallInputValue.optional, undefined)
    }

    const providerTool = roundtrip.tools?.[1]
    assert.equal(providerTool?.type, "provider")
    if (providerTool?.type === "provider") {
      assert.equal("missing" in providerTool.args, true)
      assert.equal(providerTool.args.missing, undefined)
    }
  })

  it("normalizes runtime provider tool ids when decoding call options", () => {
    const roundtrip = toRuntimeModelCallOptions(
      fromRuntimeModelCallOptions(runtimeCallOptions),
    )

    assert.deepEqual(
      sanitize(roundtrip),
      sanitize({
        ...runtimeCallOptions,
        tools: [
          {
            ...runtimeCallOptions.tools[0],
            id: "bridge.lookup",
          },
        ],
      } satisfies RuntimeModelCallOptions),
    )
    assert.equal(roundtrip.tools?.[0]?.type, "provider")
    if (roundtrip.tools?.[0]?.type === "provider") {
      assert.equal(roundtrip.tools[0].id, "bridge.lookup")
    }
  })

  it("roundtrips generate responses and preserves expected normalization", () => {
    const roundtrip = fromRuntimeGenerateResponse(
      toRuntimeGenerateResponse(generateResult),
    )

    assert.deepEqual(sanitize(roundtrip), sanitize(normalizedGenerateResult))
    assert.deepEqual(roundtrip.providerMetadata, {
      openai: toJsonObject({
        request: "metadata",
      }),
    })
    assert.deepEqual(roundtrip.usage.raw, toJsonObject({
      measured: true,
    }))
    const toolResult = roundtrip.content[8]
    assert.equal(toolResult?.type, "tool-result")
    if (toolResult?.type === "tool-result") {
      assert.deepEqual(toolResult.result, {})
    }
    assert.equal(roundtrip.request !== undefined, true)
    assert.equal(roundtrip.request?.body !== undefined, true)
    if (roundtrip.request?.body && typeof roundtrip.request.body === "object") {
      assert.equal("optional" in roundtrip.request.body, true)
      assert.equal(
        (roundtrip.request.body as Record<string, unknown>).optional,
        undefined,
      )
    }
  })

  it("roundtrips stream parts and preserves expected normalization", () => {
    const roundtrip = streamParts.map((part) =>
      fromRuntimeStreamPart(toRuntimeStreamPart(part)))

    assert.deepEqual(sanitize(roundtrip), sanitize(normalizedStreamParts))
    const firstPart = roundtrip[0]
    assert.equal(firstPart?.type, "text-start")
    if (firstPart?.type === "text-start") {
      assert.deepEqual(firstPart.providerMetadata, {
        openai: toJsonObject({
          keep: "text-start",
        }),
      })
    }

    const streamToolResult = roundtrip[11]
    assert.equal(streamToolResult?.type, "tool-result")
    if (streamToolResult?.type === "tool-result") {
      assert.deepEqual(streamToolResult.result, {})
    }

    const finishPart = roundtrip[18]
    assert.equal(finishPart?.type, "finish")
    if (finishPart?.type === "finish") {
      assert.deepEqual(finishPart.usage.raw, toJsonObject({
        keep: true,
      }))
      assert.deepEqual(finishPart.providerMetadata, {
        openai: toJsonObject({
          keep: "finish",
        }),
      })
    }

    const rawPart = roundtrip[19]
    assert.equal(rawPart?.type, "raw")
    if (rawPart?.type === "raw" && typeof rawPart.rawValue === "object" && rawPart.rawValue !== null) {
      assert.equal("optional" in rawPart.rawValue, true)
      assert.equal(
        (rawPart.rawValue as Record<string, unknown>).optional,
        undefined,
      )
    }
  })
})

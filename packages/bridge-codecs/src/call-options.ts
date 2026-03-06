import type { LanguageModelV3CallOptions } from "@ai-sdk/provider"
import type {
  RuntimeModelCallOptions,
  RuntimePromptMessage,
  RuntimeTool,
} from "@llm-bridge/contracts"
import {
  assertNever,
  decodeDataContent,
  encodeDataContent,
  fromRuntimeProviderOptions,
  isRecord,
  normalizeHeaders,
  toContractJsonObject,
  toContractJsonValue,
  toProviderJsonObject,
  toProviderToolId,
  toProviderJsonValue,
  toRuntimeProviderOptions,
  type ProviderAssistantPart,
  type ProviderPromptMessage,
  type ProviderToolPart,
  type ProviderToolResultOutput,
  type ProviderToolSpec,
  type ProviderUserPart,
  type RuntimeAssistantPart,
  type RuntimeToolPart,
  type RuntimeToolResultOutput,
  type RuntimeUserPart,
} from "./internal"
import { decodeRuntimeWireValue, encodeRuntimeWireValue } from "@llm-bridge/contracts"

function toRuntimeToolResultOutput(output: ProviderToolResultOutput): RuntimeToolResultOutput {
  switch (output.type) {
    case "text":
      return {
        type: "text",
        value: output.value,
        providerOptions: toRuntimeProviderOptions(output.providerOptions),
      }
    case "json":
      return {
        type: "json",
        value: toContractJsonValue(output.value),
        providerOptions: toRuntimeProviderOptions(output.providerOptions),
      }
    case "execution-denied":
      return {
        type: "execution-denied",
        reason: output.reason,
        providerOptions: toRuntimeProviderOptions(output.providerOptions),
      }
    case "error-text":
      return {
        type: "error-text",
        value: output.value,
        providerOptions: toRuntimeProviderOptions(output.providerOptions),
      }
    case "error-json":
      return {
        type: "error-json",
        value: toContractJsonValue(output.value),
        providerOptions: toRuntimeProviderOptions(output.providerOptions),
      }
    case "content":
      return {
        type: "content",
        value: output.value.map((part) => ({
          ...part,
          providerOptions: toRuntimeProviderOptions(part.providerOptions),
        })),
      }
    default:
      return assertNever(output)
  }
}

function fromRuntimeToolResultOutput(output: RuntimeToolResultOutput): ProviderToolResultOutput {
  switch (output.type) {
    case "text":
      return {
        type: "text",
        value: output.value,
        providerOptions: fromRuntimeProviderOptions(output.providerOptions),
      }
    case "json":
      return {
        type: "json",
        value: toProviderJsonValue(output.value),
        providerOptions: fromRuntimeProviderOptions(output.providerOptions),
      }
    case "execution-denied":
      return {
        type: "execution-denied",
        reason: output.reason,
        providerOptions: fromRuntimeProviderOptions(output.providerOptions),
      }
    case "error-text":
      return {
        type: "error-text",
        value: output.value,
        providerOptions: fromRuntimeProviderOptions(output.providerOptions),
      }
    case "error-json":
      return {
        type: "error-json",
        value: toProviderJsonValue(output.value),
        providerOptions: fromRuntimeProviderOptions(output.providerOptions),
      }
    case "content":
      return {
        type: "content",
        value: output.value.map((part) => ({
          ...part,
          providerOptions: fromRuntimeProviderOptions(part.providerOptions),
        })),
      }
    default:
      return assertNever(output)
  }
}

function toRuntimeTool(tool: ProviderToolSpec): RuntimeTool {
  if (tool.type === "provider") {
    return {
      type: "provider",
      id: tool.id,
      name: tool.name,
      args: Object.fromEntries(
        Object.entries(tool.args).map(([key, value]) => [
          key,
          encodeRuntimeWireValue(value),
        ]),
      ),
    }
  }

  return {
    type: "function",
    name: tool.name,
    description: tool.description,
    inputSchema: encodeRuntimeWireValue(tool.inputSchema),
    inputExamples: tool.inputExamples?.map((example) => ({
      input: toContractJsonObject(example.input),
    })),
    strict: tool.strict,
    providerOptions: toRuntimeProviderOptions(tool.providerOptions),
  }
}

function fromRuntimeTool(tool: RuntimeTool): ProviderToolSpec {
  if (tool.type === "provider") {
    const args = Object.fromEntries(
      Object.entries(tool.args).map(([key, value]) => [
        key,
        decodeRuntimeWireValue(value),
      ]),
    )

    return {
      type: "provider",
      id: toProviderToolId(tool.id),
      name: tool.name,
      args,
    }
  }

  const decodedInputSchema = decodeRuntimeWireValue(tool.inputSchema)

  return {
    type: "function",
    name: tool.name,
    description: tool.description,
    inputSchema: isRecord(decodedInputSchema) ? decodedInputSchema : {},
    inputExamples: tool.inputExamples?.map((example) => ({
      input: toProviderJsonObject(example.input),
    })),
    strict: tool.strict,
    providerOptions: fromRuntimeProviderOptions(tool.providerOptions),
  }
}

function toRuntimeUserPart(part: ProviderUserPart): RuntimeUserPart {
  if (part.type === "text") {
    return {
      type: "text",
      text: part.text,
      providerOptions: toRuntimeProviderOptions(part.providerOptions),
    }
  }

  return {
    type: "file",
    filename: part.filename,
    data: encodeDataContent(part.data),
    mediaType: part.mediaType,
    providerOptions: toRuntimeProviderOptions(part.providerOptions),
  }
}

function fromRuntimeUserPart(part: RuntimeUserPart): ProviderUserPart {
  if (part.type === "text") {
    return {
      type: "text",
      text: part.text,
      providerOptions: fromRuntimeProviderOptions(part.providerOptions),
    }
  }

  return {
    type: "file",
    filename: part.filename,
    data: decodeDataContent(part.data),
    mediaType: part.mediaType,
    providerOptions: fromRuntimeProviderOptions(part.providerOptions),
  }
}

function toRuntimeAssistantPart(part: ProviderAssistantPart): RuntimeAssistantPart {
  switch (part.type) {
    case "text":
      return {
        type: "text",
        text: part.text,
        providerOptions: toRuntimeProviderOptions(part.providerOptions),
      }
    case "file":
      return {
        type: "file",
        filename: part.filename,
        data: encodeDataContent(part.data),
        mediaType: part.mediaType,
        providerOptions: toRuntimeProviderOptions(part.providerOptions),
      }
    case "reasoning":
      return {
        type: "reasoning",
        text: part.text,
        providerOptions: toRuntimeProviderOptions(part.providerOptions),
      }
    case "tool-call":
      return {
        type: "tool-call",
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        input: encodeRuntimeWireValue(part.input),
        providerExecuted: part.providerExecuted,
        providerOptions: toRuntimeProviderOptions(part.providerOptions),
      }
    case "tool-result":
      return {
        type: "tool-result",
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        output: toRuntimeToolResultOutput(part.output),
        providerOptions: toRuntimeProviderOptions(part.providerOptions),
      }
    default:
      return assertNever(part)
  }
}

function fromRuntimeAssistantPart(part: RuntimeAssistantPart): ProviderAssistantPart {
  switch (part.type) {
    case "text":
      return {
        type: "text",
        text: part.text,
        providerOptions: fromRuntimeProviderOptions(part.providerOptions),
      }
    case "file":
      return {
        type: "file",
        filename: part.filename,
        data: decodeDataContent(part.data),
        mediaType: part.mediaType,
        providerOptions: fromRuntimeProviderOptions(part.providerOptions),
      }
    case "reasoning":
      return {
        type: "reasoning",
        text: part.text,
        providerOptions: fromRuntimeProviderOptions(part.providerOptions),
      }
    case "tool-call":
      return {
        type: "tool-call",
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        input: decodeRuntimeWireValue(part.input),
        providerExecuted: part.providerExecuted,
        providerOptions: fromRuntimeProviderOptions(part.providerOptions),
      }
    case "tool-result":
      return {
        type: "tool-result",
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        output: fromRuntimeToolResultOutput(part.output),
        providerOptions: fromRuntimeProviderOptions(part.providerOptions),
      }
    default:
      return assertNever(part)
  }
}

function toRuntimeToolPart(part: ProviderToolPart): RuntimeToolPart {
  if (part.type === "tool-result") {
    return {
      type: "tool-result",
      toolCallId: part.toolCallId,
      toolName: part.toolName,
      output: toRuntimeToolResultOutput(part.output),
      providerOptions: toRuntimeProviderOptions(part.providerOptions),
    }
  }

  if (part.type === "tool-approval-response") {
    return {
      type: "tool-approval-response",
      approvalId: part.approvalId,
      approved: part.approved,
      reason: part.reason,
      providerOptions: toRuntimeProviderOptions(part.providerOptions),
    }
  }

  return assertNever(part)
}

function fromRuntimeToolPart(part: RuntimeToolPart): ProviderToolPart {
  if (part.type === "tool-result") {
    return {
      type: "tool-result",
      toolCallId: part.toolCallId,
      toolName: part.toolName,
      output: fromRuntimeToolResultOutput(part.output),
      providerOptions: fromRuntimeProviderOptions(part.providerOptions),
    }
  }

  if (part.type === "tool-approval-response") {
    return {
      type: "tool-approval-response",
      approvalId: part.approvalId,
      approved: part.approved,
      reason: part.reason,
      providerOptions: fromRuntimeProviderOptions(part.providerOptions),
    }
  }

  return assertNever(part)
}

function toRuntimePromptMessage(message: ProviderPromptMessage): RuntimePromptMessage {
  switch (message.role) {
    case "system":
      return {
        role: "system",
        content: message.content,
        providerOptions: toRuntimeProviderOptions(message.providerOptions),
      }
    case "user":
      return {
        role: "user",
        content: message.content.map((part) => toRuntimeUserPart(part)),
        providerOptions: toRuntimeProviderOptions(message.providerOptions),
      }
    case "assistant":
      return {
        role: "assistant",
        content: message.content.map((part) => toRuntimeAssistantPart(part)),
        providerOptions: toRuntimeProviderOptions(message.providerOptions),
      }
    case "tool":
      return {
        role: "tool",
        content: message.content.map((part) => toRuntimeToolPart(part)),
        providerOptions: toRuntimeProviderOptions(message.providerOptions),
      }
    default:
      return assertNever(message)
  }
}

function fromRuntimePromptMessage(message: RuntimePromptMessage): ProviderPromptMessage {
  switch (message.role) {
    case "system":
      return {
        role: "system",
        content: message.content,
        providerOptions: fromRuntimeProviderOptions(message.providerOptions),
      }
    case "user":
      return {
        role: "user",
        content: message.content.map((part) => fromRuntimeUserPart(part)),
        providerOptions: fromRuntimeProviderOptions(message.providerOptions),
      }
    case "assistant":
      return {
        role: "assistant",
        content: message.content.map((part) => fromRuntimeAssistantPart(part)),
        providerOptions: fromRuntimeProviderOptions(message.providerOptions),
      }
    case "tool":
      return {
        role: "tool",
        content: message.content.map((part) => fromRuntimeToolPart(part)),
        providerOptions: fromRuntimeProviderOptions(message.providerOptions),
      }
    default:
      return assertNever(message)
  }
}

function toRuntimeResponseFormat(
  responseFormat: LanguageModelV3CallOptions["responseFormat"],
): RuntimeModelCallOptions["responseFormat"] {
  if (!responseFormat) {
    return undefined
  }

  if (responseFormat.type === "text") {
    return {
      type: "text",
    }
  }

  if (responseFormat.type === "json") {
    return {
      type: "json",
      schema: responseFormat.schema
        ? encodeRuntimeWireValue(responseFormat.schema)
        : undefined,
      name: responseFormat.name,
      description: responseFormat.description,
    }
  }

  return assertNever(responseFormat)
}

function fromRuntimeResponseFormat(
  responseFormat: RuntimeModelCallOptions["responseFormat"],
): Omit<LanguageModelV3CallOptions, "abortSignal">["responseFormat"] {
  if (!responseFormat) {
    return undefined
  }

  if (responseFormat.type === "text") {
    return {
      type: "text",
    }
  }

  if (responseFormat.type === "json") {
    const decodedSchema = responseFormat.schema === undefined
      ? undefined
      : decodeRuntimeWireValue(responseFormat.schema)

    return {
      type: "json",
      schema: isRecord(decodedSchema) ? decodedSchema : undefined,
      name: responseFormat.name,
      description: responseFormat.description,
    }
  }

  return assertNever(responseFormat)
}

export function toRuntimeModelCallOptions(
  options: LanguageModelV3CallOptions,
): RuntimeModelCallOptions {
  return {
    prompt: options.prompt.map((message) => toRuntimePromptMessage(message)),
    maxOutputTokens: options.maxOutputTokens,
    temperature: options.temperature,
    stopSequences: options.stopSequences,
    topP: options.topP,
    topK: options.topK,
    presencePenalty: options.presencePenalty,
    frequencyPenalty: options.frequencyPenalty,
    responseFormat: toRuntimeResponseFormat(options.responseFormat),
    seed: options.seed,
    tools: options.tools?.map((tool) => toRuntimeTool(tool)),
    toolChoice: options.toolChoice,
    includeRawChunks: options.includeRawChunks,
    headers: options.headers ? normalizeHeaders(options.headers) : undefined,
    providerOptions: toRuntimeProviderOptions(options.providerOptions),
  }
}

export function fromRuntimeModelCallOptions(
  options: RuntimeModelCallOptions,
): Omit<LanguageModelV3CallOptions, "abortSignal"> {
  return {
    prompt: options.prompt.map((message) => fromRuntimePromptMessage(message)),
    maxOutputTokens: options.maxOutputTokens,
    temperature: options.temperature,
    stopSequences: options.stopSequences ? [...options.stopSequences] : undefined,
    topP: options.topP,
    topK: options.topK,
    presencePenalty: options.presencePenalty,
    frequencyPenalty: options.frequencyPenalty,
    responseFormat: fromRuntimeResponseFormat(options.responseFormat),
    seed: options.seed,
    tools: options.tools?.map((tool) => fromRuntimeTool(tool)),
    toolChoice: options.toolChoice,
    includeRawChunks: options.includeRawChunks,
    headers: options.headers ? { ...options.headers } : undefined,
    providerOptions: fromRuntimeProviderOptions(options.providerOptions),
  }
}

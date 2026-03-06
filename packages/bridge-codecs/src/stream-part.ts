import type { LanguageModelV3StreamPart } from "@ai-sdk/provider"
import {
  decodeRuntimeWireValue,
  encodeRuntimeWireValue,
  type RuntimeStreamPart,
} from "@llm-bridge/contracts"
import {
  assertNever,
  decodeBinaryData,
  decodeWireDate,
  encodeBinaryData,
  encodeWireDate,
  fromRuntimeProviderMetadata,
  fromRuntimeUsage,
  fromRuntimeWarnings,
  toContractJsonValue,
  toProviderJsonValue,
  toRuntimeProviderMetadata,
  toRuntimeUsage,
  toRuntimeWarnings,
} from "./internal"

export function toRuntimeStreamPart(part: LanguageModelV3StreamPart): RuntimeStreamPart {
  switch (part.type) {
    case "text-start":
      return {
        type: "text-start",
        id: part.id,
        providerMetadata: toRuntimeProviderMetadata(part.providerMetadata),
      }
    case "text-delta":
      return {
        type: "text-delta",
        id: part.id,
        delta: part.delta,
        providerMetadata: toRuntimeProviderMetadata(part.providerMetadata),
      }
    case "text-end":
      return {
        type: "text-end",
        id: part.id,
        providerMetadata: toRuntimeProviderMetadata(part.providerMetadata),
      }
    case "reasoning-start":
      return {
        type: "reasoning-start",
        id: part.id,
        providerMetadata: toRuntimeProviderMetadata(part.providerMetadata),
      }
    case "reasoning-delta":
      return {
        type: "reasoning-delta",
        id: part.id,
        delta: part.delta,
        providerMetadata: toRuntimeProviderMetadata(part.providerMetadata),
      }
    case "reasoning-end":
      return {
        type: "reasoning-end",
        id: part.id,
        providerMetadata: toRuntimeProviderMetadata(part.providerMetadata),
      }
    case "tool-input-start":
      return {
        type: "tool-input-start",
        id: part.id,
        toolName: part.toolName,
        providerMetadata: toRuntimeProviderMetadata(part.providerMetadata),
        providerExecuted: part.providerExecuted,
        dynamic: part.dynamic,
        title: part.title,
      }
    case "tool-input-delta":
      return {
        type: "tool-input-delta",
        id: part.id,
        delta: part.delta,
        providerMetadata: toRuntimeProviderMetadata(part.providerMetadata),
      }
    case "tool-input-end":
      return {
        type: "tool-input-end",
        id: part.id,
        providerMetadata: toRuntimeProviderMetadata(part.providerMetadata),
      }
    case "tool-approval-request":
      return {
        type: "tool-approval-request",
        approvalId: part.approvalId,
        toolCallId: part.toolCallId,
        providerMetadata: toRuntimeProviderMetadata(part.providerMetadata),
      }
    case "tool-call":
      return {
        type: "tool-call",
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        input: part.input,
        providerExecuted: part.providerExecuted,
        dynamic: part.dynamic,
        providerMetadata: toRuntimeProviderMetadata(part.providerMetadata),
      }
    case "tool-result":
      return {
        type: "tool-result",
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        result: toContractJsonValue(part.result),
        isError: part.isError,
        preliminary: part.preliminary,
        dynamic: part.dynamic,
        providerMetadata: toRuntimeProviderMetadata(part.providerMetadata),
      }
    case "file":
      return {
        type: "file",
        mediaType: part.mediaType,
        data: typeof part.data === "string" ? part.data : encodeBinaryData(part.data),
        providerMetadata: toRuntimeProviderMetadata(part.providerMetadata),
      }
    case "source":
      return part.sourceType === "url"
        ? {
            type: "source",
            sourceType: "url",
            id: part.id,
            url: part.url,
            title: part.title,
            providerMetadata: toRuntimeProviderMetadata(part.providerMetadata),
          }
        : {
            type: "source",
            sourceType: "document",
            id: part.id,
            mediaType: part.mediaType,
            title: part.title,
            filename: part.filename,
            providerMetadata: toRuntimeProviderMetadata(part.providerMetadata),
          }
    case "stream-start":
      return {
        type: "stream-start",
        warnings: toRuntimeWarnings(part.warnings),
      }
    case "response-metadata":
      return {
        type: "response-metadata",
        id: part.id,
        timestamp: encodeWireDate(part.timestamp),
        modelId: part.modelId,
      }
    case "finish":
      return {
        type: "finish",
        usage: toRuntimeUsage(part.usage),
        finishReason: part.finishReason,
        providerMetadata: toRuntimeProviderMetadata(part.providerMetadata),
      }
    case "raw":
      return {
        type: "raw",
        rawValue: encodeRuntimeWireValue(part.rawValue),
      }
    case "error":
      return {
        type: "error",
        error: encodeRuntimeWireValue(part.error),
      }
    default:
      return assertNever(part)
  }
}

export function fromRuntimeStreamPart(part: RuntimeStreamPart): LanguageModelV3StreamPart {
  switch (part.type) {
    case "text-start":
      return {
        type: "text-start",
        id: part.id,
        providerMetadata: fromRuntimeProviderMetadata(part.providerMetadata),
      }
    case "text-delta":
      return {
        type: "text-delta",
        id: part.id,
        delta: part.delta,
        providerMetadata: fromRuntimeProviderMetadata(part.providerMetadata),
      }
    case "text-end":
      return {
        type: "text-end",
        id: part.id,
        providerMetadata: fromRuntimeProviderMetadata(part.providerMetadata),
      }
    case "reasoning-start":
      return {
        type: "reasoning-start",
        id: part.id,
        providerMetadata: fromRuntimeProviderMetadata(part.providerMetadata),
      }
    case "reasoning-delta":
      return {
        type: "reasoning-delta",
        id: part.id,
        delta: part.delta,
        providerMetadata: fromRuntimeProviderMetadata(part.providerMetadata),
      }
    case "reasoning-end":
      return {
        type: "reasoning-end",
        id: part.id,
        providerMetadata: fromRuntimeProviderMetadata(part.providerMetadata),
      }
    case "tool-input-start":
      return {
        type: "tool-input-start",
        id: part.id,
        toolName: part.toolName,
        providerMetadata: fromRuntimeProviderMetadata(part.providerMetadata),
        providerExecuted: part.providerExecuted,
        dynamic: part.dynamic,
        title: part.title,
      }
    case "tool-input-delta":
      return {
        type: "tool-input-delta",
        id: part.id,
        delta: part.delta,
        providerMetadata: fromRuntimeProviderMetadata(part.providerMetadata),
      }
    case "tool-input-end":
      return {
        type: "tool-input-end",
        id: part.id,
        providerMetadata: fromRuntimeProviderMetadata(part.providerMetadata),
      }
    case "tool-approval-request":
      return {
        type: "tool-approval-request",
        approvalId: part.approvalId,
        toolCallId: part.toolCallId,
        providerMetadata: fromRuntimeProviderMetadata(part.providerMetadata),
      }
    case "tool-call":
      return {
        type: "tool-call",
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        input: part.input,
        providerExecuted: part.providerExecuted,
        dynamic: part.dynamic,
        providerMetadata: fromRuntimeProviderMetadata(part.providerMetadata),
      }
    case "tool-result": {
      const result = toProviderJsonValue(part.result)
      return {
        type: "tool-result",
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        result: result === null ? {} : result,
        isError: part.isError,
        preliminary: part.preliminary,
        dynamic: part.dynamic,
        providerMetadata: fromRuntimeProviderMetadata(part.providerMetadata),
      }
    }
    case "file":
      return {
        type: "file",
        mediaType: part.mediaType,
        data: typeof part.data === "string" ? part.data : decodeBinaryData(part.data),
        providerMetadata: fromRuntimeProviderMetadata(part.providerMetadata),
      }
    case "source":
      return part.sourceType === "url"
        ? {
            type: "source",
            sourceType: "url",
            id: part.id,
            url: part.url,
            title: part.title,
            providerMetadata: fromRuntimeProviderMetadata(part.providerMetadata),
          }
        : {
            type: "source",
            sourceType: "document",
            id: part.id,
            mediaType: part.mediaType,
            title: part.title,
            filename: part.filename,
            providerMetadata: fromRuntimeProviderMetadata(part.providerMetadata),
          }
    case "stream-start":
      return {
        type: "stream-start",
        warnings: fromRuntimeWarnings(part.warnings),
      }
    case "response-metadata":
      return {
        type: "response-metadata",
        id: part.id,
        timestamp: decodeWireDate(part.timestamp),
        modelId: part.modelId,
      }
    case "finish":
      return {
        type: "finish",
        usage: fromRuntimeUsage(part.usage),
        finishReason: {
          unified: part.finishReason.unified,
          raw: part.finishReason.raw,
        },
        providerMetadata: fromRuntimeProviderMetadata(part.providerMetadata),
      }
    case "raw":
      return {
        type: "raw",
        rawValue: decodeRuntimeWireValue(part.rawValue),
      }
    case "error":
      return {
        type: "error",
        error: decodeRuntimeWireValue(part.error),
      }
    default:
      return assertNever(part)
  }
}

import type { LanguageModelV3GenerateResult } from "@ai-sdk/provider";
import {
  decodeRuntimeWireValue,
  encodeRuntimeWireValue,
  type RuntimeGenerateResponse,
} from "@llm-bridge/contracts";
import {
  assertNever,
  decodeBinaryData,
  decodeWireDate,
  encodeBinaryData,
  encodeWireDate,
  fromRuntimeProviderMetadata,
  fromRuntimeUsage,
  fromRuntimeWarnings,
  toProviderJsonValue,
  toContractJsonValue,
  toRuntimeProviderMetadata,
  toRuntimeUsage,
  toRuntimeWarnings,
} from "./internal";

function toRuntimeContentPart(
  part: LanguageModelV3GenerateResult["content"][number],
): RuntimeGenerateResponse["content"][number] {
  switch (part.type) {
    case "text":
      return {
        type: "text",
        text: part.text,
        providerMetadata: toRuntimeProviderMetadata(part.providerMetadata),
      };
    case "reasoning":
      return {
        type: "reasoning",
        text: part.text,
        providerMetadata: toRuntimeProviderMetadata(part.providerMetadata),
      };
    case "file":
      return {
        type: "file",
        mediaType: part.mediaType,
        data:
          typeof part.data === "string"
            ? part.data
            : encodeBinaryData(part.data),
        providerMetadata: toRuntimeProviderMetadata(part.providerMetadata),
      };
    case "tool-approval-request":
      return {
        type: "tool-approval-request",
        approvalId: part.approvalId,
        toolCallId: part.toolCallId,
        providerMetadata: toRuntimeProviderMetadata(part.providerMetadata),
      };
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
          };
    case "tool-call":
      return {
        type: "tool-call",
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        input: part.input,
        providerExecuted: part.providerExecuted,
        dynamic: part.dynamic,
        providerMetadata: toRuntimeProviderMetadata(part.providerMetadata),
      };
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
      };
    default:
      return assertNever(part);
  }
}

function fromRuntimeContentPart(
  part: RuntimeGenerateResponse["content"][number],
): LanguageModelV3GenerateResult["content"][number] {
  switch (part.type) {
    case "text":
      return {
        type: "text",
        text: part.text,
        providerMetadata: fromRuntimeProviderMetadata(part.providerMetadata),
      };
    case "reasoning":
      return {
        type: "reasoning",
        text: part.text,
        providerMetadata: fromRuntimeProviderMetadata(part.providerMetadata),
      };
    case "file":
      return {
        type: "file",
        mediaType: part.mediaType,
        data:
          typeof part.data === "string"
            ? part.data
            : decodeBinaryData(part.data),
        providerMetadata: fromRuntimeProviderMetadata(part.providerMetadata),
      };
    case "tool-approval-request":
      return {
        type: "tool-approval-request",
        approvalId: part.approvalId,
        toolCallId: part.toolCallId,
        providerMetadata: fromRuntimeProviderMetadata(part.providerMetadata),
      };
    case "source":
      return part.sourceType === "url"
        ? {
            type: "source",
            sourceType: "url",
            id: part.id,
            url: part.url,
            title: part.title,
            providerMetadata: fromRuntimeProviderMetadata(
              part.providerMetadata,
            ),
          }
        : {
            type: "source",
            sourceType: "document",
            id: part.id,
            mediaType: part.mediaType,
            title: part.title,
            filename: part.filename,
            providerMetadata: fromRuntimeProviderMetadata(
              part.providerMetadata,
            ),
          };
    case "tool-call":
      return {
        type: "tool-call",
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        input: part.input,
        providerExecuted: part.providerExecuted,
        dynamic: part.dynamic,
        providerMetadata: fromRuntimeProviderMetadata(part.providerMetadata),
      };
    case "tool-result": {
      const result = toProviderJsonValue(part.result);
      return {
        type: "tool-result",
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        result: result === null ? {} : result,
        isError: part.isError,
        preliminary: part.preliminary,
        dynamic: part.dynamic,
        providerMetadata: fromRuntimeProviderMetadata(part.providerMetadata),
      };
    }
    default:
      return assertNever(part);
  }
}

export function toRuntimeGenerateResponse(
  result: LanguageModelV3GenerateResult,
): RuntimeGenerateResponse {
  return {
    content: result.content.map((part) => toRuntimeContentPart(part)),
    finishReason: {
      unified: result.finishReason.unified,
      raw: result.finishReason.raw,
    },
    usage: toRuntimeUsage(result.usage),
    providerMetadata: toRuntimeProviderMetadata(result.providerMetadata),
    request: result.request
      ? {
          body:
            result.request.body === undefined
              ? undefined
              : encodeRuntimeWireValue(result.request.body),
        }
      : undefined,
    response: result.response
      ? {
          id: result.response.id,
          timestamp: encodeWireDate(result.response.timestamp),
          modelId: result.response.modelId,
          headers: result.response.headers
            ? { ...result.response.headers }
            : undefined,
          body:
            result.response.body === undefined
              ? undefined
              : encodeRuntimeWireValue(result.response.body),
        }
      : undefined,
    warnings: toRuntimeWarnings(result.warnings),
  };
}

export function fromRuntimeGenerateResponse(
  response: RuntimeGenerateResponse,
): LanguageModelV3GenerateResult {
  return {
    content: response.content.map((part) => fromRuntimeContentPart(part)),
    finishReason: {
      unified: response.finishReason.unified,
      raw: response.finishReason.raw,
    },
    usage: fromRuntimeUsage(response.usage),
    providerMetadata: fromRuntimeProviderMetadata(response.providerMetadata),
    request: response.request
      ? {
          body:
            response.request.body === undefined
              ? undefined
              : decodeRuntimeWireValue(response.request.body),
        }
      : undefined,
    response: response.response
      ? {
          id: response.response.id,
          timestamp: decodeWireDate(response.response.timestamp),
          modelId: response.response.modelId,
          headers: response.response.headers
            ? { ...response.response.headers }
            : undefined,
          body:
            response.response.body === undefined
              ? undefined
              : decodeRuntimeWireValue(response.response.body),
        }
      : undefined,
    warnings: fromRuntimeWarnings(response.warnings),
  };
}

import {
  AuthFlowExpiredError,
  ModelNotFoundError,
  PAGE_BRIDGE_INIT_MESSAGE,
  PAGE_BRIDGE_PORT_CONTROL_MESSAGE,
  PAGE_BRIDGE_READY_EVENT,
  PermissionDeniedError,
  PageBridgeRpcGroup,
  ProviderNotConnectedError,
  RuntimeValidationError,
  TransportProtocolError,
  decodeRuntimeWireValue,
  decodeSupportedUrls,
  encodeRuntimeWireValue,
  type BridgePermissionRequest,
  type BridgeModelDescriptorResponse,
  type BridgeStateResponse,
  type JsonValue,
  type PageBridgeRpc,
  type RuntimeCreatePermissionRequestResponse,
  type RuntimeDismissPermissionRequestResponse,
  type RuntimeGenerateResponse,
  type RuntimeModelCallOptions,
  type RuntimeModelSummary,
  type RuntimeRpcError,
  type RuntimeResolvePermissionRequestResponse,
  type RuntimeStreamPart,
  type RuntimeTool,
  type RuntimeWireDate,
  type RuntimeWireUint8Array,
  type RuntimeWireUrl,
  type PageBridgePortControlMessage,
} from "@llm-bridge/contracts";
import type {
  JSONValue,
  JSONObject,
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamPart,
  SharedV3ProviderMetadata,
  SharedV3ProviderOptions,
  SharedV3Warning,
} from "@ai-sdk/provider";
import * as RpcClient from "@effect/rpc/RpcClient";
import { RpcClientError } from "@effect/rpc/RpcClientError";
import type { FromClientEncoded, FromServerEncoded } from "@effect/rpc/RpcMessage";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

const DEFAULT_TIMEOUT_MS = 30_000;
let nextBridgeConnectionId = 0;

type PageBridgeClient = Effect.Effect.Success<
  ReturnType<typeof RpcClient.make<PageBridgeRpc>>
>;

type BridgeConnection = {
  connectionId: number;
  scope: Scope.CloseableScope;
  port: MessagePort;
  client: PageBridgeClient;
};

type ContractPromptMessage = RuntimeModelCallOptions["prompt"][number];
type ContractToolSpec = RuntimeTool;

type ProviderPromptMessage = LanguageModelV3CallOptions["prompt"][number];
type ProviderToolSpec = NonNullable<
  LanguageModelV3CallOptions["tools"]
>[number];

type ContractUserMessage = Extract<ContractPromptMessage, { role: "user" }>;
type ContractAssistantMessage = Extract<
  ContractPromptMessage,
  { role: "assistant" }
>;
type ContractToolMessage = Extract<ContractPromptMessage, { role: "tool" }>;

type ProviderUserPart = Extract<
  ProviderPromptMessage,
  { role: "user" }
>["content"][number];
type ProviderAssistantPart = Extract<
  ProviderPromptMessage,
  { role: "assistant" }
>["content"][number];
type ProviderToolPart = Extract<
  ProviderPromptMessage,
  { role: "tool" }
>["content"][number];

type ProviderToolResultOutput = Extract<
  ProviderAssistantPart,
  { type: "tool-result" }
>["output"];
type ContractToolResultOutput = Extract<
  ContractAssistantMessage["content"][number],
  { type: "tool-result" }
>["output"];

export type BridgeClientOptions = {
  timeoutMs?: number;
  debug?: boolean;
  logger?: typeof console.info;
};

export type BridgeModelSummary = RuntimeModelSummary;
export type BridgePermissionResult =
  | RuntimeCreatePermissionRequestResponse
  | RuntimeDismissPermissionRequestResponse
  | RuntimeResolvePermissionRequestResponse;

export interface BridgeClientApi {
  readonly listModels: Effect.Effect<
    ReadonlyArray<BridgeModelSummary>,
    RuntimeRpcError
  >;
  getModel: (
    modelId: string,
  ) => Effect.Effect<LanguageModelV3, RuntimeRpcError>;
  readonly getState: Effect.Effect<BridgeStateResponse, RuntimeRpcError>;
  requestPermission: (
    payload?: BridgePermissionRequest,
  ) => Effect.Effect<BridgePermissionResult, RuntimeRpcError>;
  readonly destroy: Effect.Effect<void, never>;
}

export class BridgeClient extends Context.Tag(
  "@llm-bridge/client/BridgeClient",
)<BridgeClient, BridgeClientApi>() {}

function createAbortError() {
  const error = new Error("The operation was aborted");
  error.name = "AbortError";
  return error;
}

function toRuntimeRpcError(error: unknown): RuntimeRpcError {
  if (
    error instanceof PermissionDeniedError ||
    error instanceof ModelNotFoundError ||
    error instanceof ProviderNotConnectedError ||
    error instanceof AuthFlowExpiredError ||
    error instanceof TransportProtocolError ||
    error instanceof RuntimeValidationError
  ) {
    return error;
  }

  return new RuntimeValidationError({
    message: error instanceof Error ? error.message : String(error),
  });
}

function log(
  debug: boolean,
  logger: typeof console.info,
  event: string,
  meta?: unknown,
) {
  if (!debug) return;
  logger(
    "[llm-bridge-client]",
    new Date().toISOString(),
    event,
    formatLogMeta(meta),
  );
}

function formatLogMeta(meta: unknown): string {
  if (meta === undefined) return "";
  if (typeof meta === "string") return meta;

  try {
    return JSON.stringify(meta, (_key, value) =>
      typeof value === "bigint" ? value.toString() : value,
    );
  } catch {
    return String(meta);
  }
}

function summarizeRpcMessage(message: unknown): Record<string, unknown> {
  if (typeof message !== "object" || message === null) {
    return { type: typeof message };
  }

  const record = message as Record<string, unknown>;
  const summary: Record<string, unknown> = {};

  for (const key of [
    "_id",
    "_tag",
    "id",
    "requestId",
    "tag",
    "method",
    "clientId",
  ]) {
    if (key in record) {
      summary[key] = record[key];
    }
  }

  if ("payload" in record && typeof record.payload === "object") {
    const payload = record.payload as Record<string, unknown>;
    summary.payloadKeys = Object.keys(payload);
  }

  if ("values" in record && Array.isArray(record.values)) {
    summary.valuesLength = record.values.length;
  }

  if ("exit" in record && typeof record.exit === "object" && record.exit) {
    const exit = record.exit as Record<string, unknown>;
    if ("_tag" in exit) {
      summary.exitTag = exit._tag;
    }
  }

  return summary;
}

function waitForBridgeReady(timeoutMs: number) {
  return new Promise<void>((resolve, reject) => {
    if (typeof window === "undefined") {
      resolve();
      return;
    }

    if (document.documentElement.dataset.llmBridgeReady === "true") {
      resolve();
      return;
    }

    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error(`Bridge initialization timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    const onReady = () => {
      cleanup();
      resolve();
    };

    const cleanup = () => {
      window.clearTimeout(timer);
      window.removeEventListener(PAGE_BRIDGE_READY_EVENT, onReady);
    };

    window.addEventListener(PAGE_BRIDGE_READY_EVENT, onReady, { once: true });
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isWireUrl(value: unknown): value is RuntimeWireUrl {
  return (
    isRecord(value) &&
    value.__llmBridgeWireType === "url" &&
    typeof value.href === "string"
  );
}

function isWireUint8Array(value: unknown): value is RuntimeWireUint8Array {
  return (
    isRecord(value) &&
    value.__llmBridgeWireType === "uint8array" &&
    typeof value.base64 === "string"
  );
}

function encodeDataContent(
  value: string | URL | Uint8Array,
): string | RuntimeWireUrl | RuntimeWireUint8Array {
  if (typeof value === "string") {
    return value;
  }

  const encoded = encodeRuntimeWireValue(value);
  if (isWireUrl(encoded) || isWireUint8Array(encoded)) {
    return encoded;
  }

  throw new RuntimeValidationError({
    message: "Failed to encode prompt file data for runtime wire transport",
  });
}

function decodeGeneratedBinaryData(value: RuntimeWireUint8Array): Uint8Array {
  const decoded = decodeRuntimeWireValue(value);
  if (decoded instanceof Uint8Array) {
    return decoded;
  }

  throw new RuntimeValidationError({
    message:
      "Failed to decode generated binary data from runtime wire transport",
  });
}

function decodeWireDate(value: RuntimeWireDate | undefined): Date | undefined {
  if (!value) {
    return undefined;
  }

  const decoded = decodeRuntimeWireValue(value);
  if (decoded instanceof Date) {
    return decoded;
  }

  throw new RuntimeValidationError({
    message: "Failed to decode timestamp from runtime wire transport",
  });
}

function toContractJsonValue(value: JSONValue): JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => toContractJsonValue(entry));
  }

  const output: Record<string, JsonValue> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry === undefined) continue;
    output[key] = toContractJsonValue(entry);
  }
  return output;
}

function toContractJsonObject(value: JSONObject): {
  readonly [key: string]: JsonValue;
} {
  return toContractJsonValue(value) as { readonly [key: string]: JsonValue };
}

function toProviderJsonValue(value: JsonValue): JSONValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => toProviderJsonValue(entry));
  }

  const output: Record<string, JSONValue | undefined> = {};
  for (const [key, entry] of Object.entries(value)) {
    output[key] = toProviderJsonValue(entry);
  }
  return output;
}

function toProviderJsonObject(value: {
  readonly [key: string]: JsonValue;
}): JSONObject {
  return toProviderJsonValue(value) as JSONObject;
}

function toContractProviderOptions(
  value: SharedV3ProviderOptions | undefined,
): RuntimeModelCallOptions["providerOptions"] {
  if (!value) return undefined;

  return Object.fromEntries(
    Object.entries(value).map(([provider, options]) => [
      provider,
      toContractJsonObject(options),
    ]),
  );
}

function toProviderMetadata(
  value: RuntimeGenerateResponse["providerMetadata"],
): SharedV3ProviderMetadata | undefined {
  if (!value) return undefined;

  return Object.fromEntries(
    Object.entries(value).map(([provider, metadata]) => [
      provider,
      toProviderJsonObject(metadata),
    ]),
  );
}

function normalizeHeaders(
  headers: Record<string, string | undefined> | undefined,
) {
  if (!headers) return undefined;

  const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value !== "string") continue;
    output[key] = value;
  }
  return output;
}

function encodeToolResultOutput(
  output: ProviderToolResultOutput,
): ContractToolResultOutput {
  switch (output.type) {
    case "text":
      return {
        type: "text",
        value: output.value,
        providerOptions: toContractProviderOptions(output.providerOptions),
      };
    case "json":
      return {
        type: "json",
        value: toContractJsonValue(output.value),
        providerOptions: toContractProviderOptions(output.providerOptions),
      };
    case "execution-denied":
      return {
        type: "execution-denied",
        reason: output.reason,
        providerOptions: toContractProviderOptions(output.providerOptions),
      };
    case "error-text":
      return {
        type: "error-text",
        value: output.value,
        providerOptions: toContractProviderOptions(output.providerOptions),
      };
    case "error-json":
      return {
        type: "error-json",
        value: toContractJsonValue(output.value),
        providerOptions: toContractProviderOptions(output.providerOptions),
      };
    case "content":
      return {
        type: "content",
        value: output.value.map((part) => ({
          ...part,
          providerOptions: toContractProviderOptions(part.providerOptions),
        })),
      };
  }
}

function encodeTool(tool: ProviderToolSpec): ContractToolSpec {
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
    };
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
    providerOptions: toContractProviderOptions(tool.providerOptions),
  };
}

function encodeUserPart(
  part: ProviderUserPart,
): ContractUserMessage["content"][number] {
  if (part.type === "text") {
    return {
      type: "text",
      text: part.text,
      providerOptions: toContractProviderOptions(part.providerOptions),
    };
  }

  return {
    type: "file",
    filename: part.filename,
    data: encodeDataContent(part.data),
    mediaType: part.mediaType,
    providerOptions: toContractProviderOptions(part.providerOptions),
  };
}

function encodeAssistantPart(
  part: ProviderAssistantPart,
): ContractAssistantMessage["content"][number] {
  switch (part.type) {
    case "text":
      return {
        type: "text",
        text: part.text,
        providerOptions: toContractProviderOptions(part.providerOptions),
      };
    case "file":
      return {
        type: "file",
        filename: part.filename,
        data: encodeDataContent(part.data),
        mediaType: part.mediaType,
        providerOptions: toContractProviderOptions(part.providerOptions),
      };
    case "reasoning":
      return {
        type: "reasoning",
        text: part.text,
        providerOptions: toContractProviderOptions(part.providerOptions),
      };
    case "tool-call":
      return {
        type: "tool-call",
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        input: encodeRuntimeWireValue(part.input),
        providerExecuted: part.providerExecuted,
        providerOptions: toContractProviderOptions(part.providerOptions),
      };
    case "tool-result":
      return {
        type: "tool-result",
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        output: encodeToolResultOutput(part.output),
        providerOptions: toContractProviderOptions(part.providerOptions),
      };
  }
}

function encodeToolPart(
  part: ProviderToolPart,
): ContractToolMessage["content"][number] {
  if (part.type === "tool-result") {
    return {
      type: "tool-result",
      toolCallId: part.toolCallId,
      toolName: part.toolName,
      output: encodeToolResultOutput(part.output),
      providerOptions: toContractProviderOptions(part.providerOptions),
    };
  }

  return {
    type: "tool-approval-response",
    approvalId: part.approvalId,
    approved: part.approved,
    reason: part.reason,
    providerOptions: toContractProviderOptions(part.providerOptions),
  };
}

function encodePromptMessage(
  message: ProviderPromptMessage,
): ContractPromptMessage {
  switch (message.role) {
    case "system":
      return {
        role: "system",
        content: message.content,
        providerOptions: toContractProviderOptions(message.providerOptions),
      };
    case "user":
      return {
        role: "user",
        content: message.content.map((part) => encodeUserPart(part)),
        providerOptions: toContractProviderOptions(message.providerOptions),
      };
    case "assistant":
      return {
        role: "assistant",
        content: message.content.map((part) => encodeAssistantPart(part)),
        providerOptions: toContractProviderOptions(message.providerOptions),
      };
    case "tool":
      return {
        role: "tool",
        content: message.content.map((part) => encodeToolPart(part)),
        providerOptions: toContractProviderOptions(message.providerOptions),
      };
  }
}

function encodeResponseFormat(
  responseFormat: LanguageModelV3CallOptions["responseFormat"],
): RuntimeModelCallOptions["responseFormat"] {
  if (!responseFormat) {
    return undefined;
  }

  if (responseFormat.type === "text") {
    return {
      type: "text",
    };
  }

  return {
    type: "json",
    schema: responseFormat.schema
      ? encodeRuntimeWireValue(responseFormat.schema)
      : undefined,
    name: responseFormat.name,
    description: responseFormat.description,
  };
}

function encodeCallOptions(
  options: LanguageModelV3CallOptions,
): RuntimeModelCallOptions {
  return {
    prompt: options.prompt.map((message) => encodePromptMessage(message)),
    maxOutputTokens: options.maxOutputTokens,
    temperature: options.temperature,
    stopSequences: options.stopSequences,
    topP: options.topP,
    topK: options.topK,
    presencePenalty: options.presencePenalty,
    frequencyPenalty: options.frequencyPenalty,
    responseFormat: encodeResponseFormat(options.responseFormat),
    seed: options.seed,
    tools: options.tools?.map((tool) => encodeTool(tool)),
    toolChoice: options.toolChoice,
    includeRawChunks: options.includeRawChunks,
    headers: normalizeHeaders(options.headers),
    providerOptions: toContractProviderOptions(options.providerOptions),
  };
}

function decodeContentPart(
  part: RuntimeGenerateResponse["content"][number],
): LanguageModelV3GenerateResult["content"][number] {
  switch (part.type) {
    case "text":
      return {
        type: "text",
        text: part.text,
        providerMetadata: toProviderMetadata(part.providerMetadata),
      };
    case "reasoning":
      return {
        type: "reasoning",
        text: part.text,
        providerMetadata: toProviderMetadata(part.providerMetadata),
      };
    case "file":
      return {
        type: "file",
        mediaType: part.mediaType,
        data:
          typeof part.data === "string"
            ? part.data
            : decodeGeneratedBinaryData(part.data),
        providerMetadata: toProviderMetadata(part.providerMetadata),
      };
    case "tool-approval-request":
      return {
        type: "tool-approval-request",
        approvalId: part.approvalId,
        toolCallId: part.toolCallId,
        providerMetadata: toProviderMetadata(part.providerMetadata),
      };
    case "source":
      return part.sourceType === "url"
        ? {
            type: "source",
            sourceType: "url",
            id: part.id,
            url: part.url,
            title: part.title,
            providerMetadata: toProviderMetadata(part.providerMetadata),
          }
        : {
            type: "source",
            sourceType: "document",
            id: part.id,
            mediaType: part.mediaType,
            title: part.title,
            filename: part.filename,
            providerMetadata: toProviderMetadata(part.providerMetadata),
          };
    case "tool-call":
      return {
        type: "tool-call",
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        input: part.input,
        providerExecuted: part.providerExecuted,
        dynamic: part.dynamic,
        providerMetadata: toProviderMetadata(part.providerMetadata),
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
        providerMetadata: toProviderMetadata(part.providerMetadata),
      };
    }
  }
}

function decodeGenerateResponse(
  response: RuntimeGenerateResponse,
): LanguageModelV3GenerateResult {
  return {
    content: response.content.map((part) => decodeContentPart(part)),
    finishReason: {
      unified: response.finishReason.unified,
      raw: response.finishReason.raw,
    },
    usage: {
      inputTokens: {
        total: response.usage.inputTokens.total,
        noCache: response.usage.inputTokens.noCache,
        cacheRead: response.usage.inputTokens.cacheRead,
        cacheWrite: response.usage.inputTokens.cacheWrite,
      },
      outputTokens: {
        total: response.usage.outputTokens.total,
        text: response.usage.outputTokens.text,
        reasoning: response.usage.outputTokens.reasoning,
      },
      raw: response.usage.raw
        ? toProviderJsonObject(response.usage.raw)
        : undefined,
    },
    providerMetadata: toProviderMetadata(response.providerMetadata),
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
    warnings: response.warnings.map((warning) => ({
      ...warning,
    })) as Array<SharedV3Warning>,
  };
}

function decodeStreamPart(part: RuntimeStreamPart): LanguageModelV3StreamPart {
  switch (part.type) {
    case "text-start":
      return {
        type: "text-start",
        id: part.id,
        providerMetadata: toProviderMetadata(part.providerMetadata),
      };
    case "text-delta":
      return {
        type: "text-delta",
        id: part.id,
        delta: part.delta,
        providerMetadata: toProviderMetadata(part.providerMetadata),
      };
    case "text-end":
      return {
        type: "text-end",
        id: part.id,
        providerMetadata: toProviderMetadata(part.providerMetadata),
      };
    case "reasoning-start":
      return {
        type: "reasoning-start",
        id: part.id,
        providerMetadata: toProviderMetadata(part.providerMetadata),
      };
    case "reasoning-delta":
      return {
        type: "reasoning-delta",
        id: part.id,
        delta: part.delta,
        providerMetadata: toProviderMetadata(part.providerMetadata),
      };
    case "reasoning-end":
      return {
        type: "reasoning-end",
        id: part.id,
        providerMetadata: toProviderMetadata(part.providerMetadata),
      };
    case "tool-input-start":
      return {
        type: "tool-input-start",
        id: part.id,
        toolName: part.toolName,
        providerMetadata: toProviderMetadata(part.providerMetadata),
        providerExecuted: part.providerExecuted,
        dynamic: part.dynamic,
        title: part.title,
      };
    case "tool-input-delta":
      return {
        type: "tool-input-delta",
        id: part.id,
        delta: part.delta,
        providerMetadata: toProviderMetadata(part.providerMetadata),
      };
    case "tool-input-end":
      return {
        type: "tool-input-end",
        id: part.id,
        providerMetadata: toProviderMetadata(part.providerMetadata),
      };
    case "tool-approval-request":
      return {
        type: "tool-approval-request",
        approvalId: part.approvalId,
        toolCallId: part.toolCallId,
        providerMetadata: toProviderMetadata(part.providerMetadata),
      };
    case "tool-call":
      return {
        type: "tool-call",
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        input: part.input,
        providerExecuted: part.providerExecuted,
        dynamic: part.dynamic,
        providerMetadata: toProviderMetadata(part.providerMetadata),
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
        providerMetadata: toProviderMetadata(part.providerMetadata),
      };
    }
    case "file":
      return {
        type: "file",
        mediaType: part.mediaType,
        data:
          typeof part.data === "string"
            ? part.data
            : decodeGeneratedBinaryData(part.data),
        providerMetadata: toProviderMetadata(part.providerMetadata),
      };
    case "source":
      return part.sourceType === "url"
        ? {
            type: "source",
            sourceType: "url",
            id: part.id,
            url: part.url,
            title: part.title,
            providerMetadata: toProviderMetadata(part.providerMetadata),
          }
        : {
            type: "source",
            sourceType: "document",
            id: part.id,
            mediaType: part.mediaType,
            title: part.title,
            filename: part.filename,
            providerMetadata: toProviderMetadata(part.providerMetadata),
          };
    case "stream-start":
      return {
        type: "stream-start",
        warnings: part.warnings.map((warning) => ({
          ...warning,
        })) as Array<SharedV3Warning>,
      };
    case "response-metadata":
      return {
        type: "response-metadata",
        id: part.id,
        timestamp: decodeWireDate(part.timestamp),
        modelId: part.modelId,
      };
    case "finish":
      return {
        type: "finish",
        usage: {
          inputTokens: {
            total: part.usage.inputTokens.total,
            noCache: part.usage.inputTokens.noCache,
            cacheRead: part.usage.inputTokens.cacheRead,
            cacheWrite: part.usage.inputTokens.cacheWrite,
          },
          outputTokens: {
            total: part.usage.outputTokens.total,
            text: part.usage.outputTokens.text,
            reasoning: part.usage.outputTokens.reasoning,
          },
          raw: part.usage.raw
            ? toProviderJsonObject(part.usage.raw)
            : undefined,
        },
        finishReason: {
          unified: part.finishReason.unified,
          raw: part.finishReason.raw,
        },
        providerMetadata: toProviderMetadata(part.providerMetadata),
      };
    case "raw":
      return {
        type: "raw",
        rawValue: decodeRuntimeWireValue(part.rawValue),
      };
    case "error":
      return {
        type: "error",
        error: decodeRuntimeWireValue(part.error),
      };
  }
}

function createConnection(
  options: BridgeClientOptions,
): Effect.Effect<BridgeConnection, RuntimeRpcError> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const debug = options.debug ?? false;
  const logger = options.logger ?? console.info;
  const connectionId = ++nextBridgeConnectionId;

  return Effect.tryPromise({
    try: async () => {
      log(debug, logger, "rpc.connect.start", {
        connectionId,
        timeoutMs,
        bridgeReady:
          typeof document !== "undefined"
            ? document.documentElement.dataset.llmBridgeReady
            : undefined,
      });
      await waitForBridgeReady(timeoutMs);
      log(debug, logger, "rpc.connect.ready", {
        connectionId,
      });

      const scope = await Effect.runPromise(Scope.make());
      const messageChannel = new MessageChannel();
      const port = messageChannel.port1;

      const protocol = await Effect.runPromise(
        RpcClient.Protocol.make((writeResponse) =>
          Effect.gen(function* () {
            const onMessage = (event: MessageEvent<FromServerEncoded>) => {
              log(debug, logger, "rpc.port.inbound", {
                connectionId,
                message: summarizeRpcMessage(event.data),
              });
              void Effect.runPromise(writeResponse(event.data)).catch((error) => {
                log(
                  debug,
                  logger,
                  "rpc.writeError",
                  {
                    connectionId,
                    message: error instanceof Error ? error.message : String(error),
                    inbound: summarizeRpcMessage(event.data),
                  },
                );
              });
            };

            const onMessageError = (event: MessageEvent<unknown>) => {
              log(debug, logger, "rpc.messageError", {
                connectionId,
                data: summarizeRpcMessage(event.data),
              });
            };

            port.addEventListener("message", onMessage);
            port.addEventListener("messageerror", onMessageError);
            port.start();

            yield* Effect.addFinalizer(() =>
              Effect.sync(() => {
                port.removeEventListener("message", onMessage);
                port.removeEventListener("messageerror", onMessageError);
              }),
            );

            return {
              send: (message: FromClientEncoded) =>
                Effect.try({
                  try: () => {
                    log(debug, logger, "rpc.port.outbound", {
                      connectionId,
                      message: summarizeRpcMessage(message),
                    });
                    port.postMessage(message);
                  },
                  catch: (cause) =>
                    new RpcClientError({
                      reason: "Protocol",
                      message: "Failed to post page bridge RPC message",
                      cause,
                    }),
                }),
              supportsAck: true,
              supportsTransferables: false,
            } as const;
          }),
        ).pipe(Scope.extend(scope)),
      );

      const client = await Effect.runPromise(
        RpcClient.make(PageBridgeRpcGroup, {
          disableTracing: true,
        }).pipe(
          Effect.provideService(RpcClient.Protocol, protocol),
          Scope.extend(scope),
        ),
      );

      log(debug, logger, "rpc.handshake.postMessage", {
        connectionId,
        type: PAGE_BRIDGE_INIT_MESSAGE,
      });
      window.postMessage({ type: PAGE_BRIDGE_INIT_MESSAGE }, "*", [
        messageChannel.port2,
      ]);

      log(debug, logger, "rpc.connected", {
        connectionId,
        bridgeReady:
          typeof document !== "undefined"
            ? document.documentElement.dataset.llmBridgeReady
            : undefined,
      });

      return {
        connectionId,
        scope,
        port,
        client,
      };
    },
    catch: toRuntimeRpcError,
  });
}

function nextRequestId(sequence: number) {
  return `req_${Date.now()}_${sequence}`;
}

export function BridgeClientLive(options: BridgeClientOptions = {}) {
  const debug = options.debug ?? false;
  const logger = options.logger ?? console.info;

  return Layer.scoped(
    BridgeClient,
    Effect.gen(function* () {
      let sequence = 0;
      let connection: BridgeConnection | null = null;
      let connectionPromise: Promise<BridgeConnection> | null = null;

      const ensureConnection = Effect.tryPromise({
        try: async () => {
          if (connection) {
            log(debug, logger, "rpc.connection.reuse", {
              connectionId: connection.connectionId,
            });
            return connection;
          }
          if (!connectionPromise) {
            log(debug, logger, "rpc.connection.create");
            connectionPromise = Effect.runPromise(
              createConnection(options),
            ).then((value) => {
              connection = value;
              return value;
            });
          } else {
            log(debug, logger, "rpc.connection.await");
          }
          return connectionPromise;
        },
        catch: toRuntimeRpcError,
      });

      const normalizeRpcError = <A, R>(
        effect: Effect.Effect<A, RuntimeRpcError | RpcClientError, R>,
      ): Effect.Effect<A, RuntimeRpcError, R> =>
        Effect.mapError(effect, toRuntimeRpcError);

      const normalizeRpcStreamError = <A, R>(
        stream: Stream.Stream<A, RuntimeRpcError | RpcClientError, R>,
      ): Stream.Stream<A, RuntimeRpcError, R> =>
        Stream.mapError(stream, toRuntimeRpcError);

      const abortRequest = (requestId: string) =>
        ensureConnection.pipe(
          Effect.flatMap((current) =>
            normalizeRpcError(current.client.abort({ requestId })),
          ),
          Effect.asVoid,
        );

      const destroy = Effect.tryPromise({
        try: async () => {
          connectionPromise = null;
          if (!connection) return;

          const current = connection;
          connection = null;
          log(debug, logger, "rpc.destroy.start", {
            connectionId: current.connectionId,
          });

          const disconnectMessage: PageBridgePortControlMessage = {
            _tag: PAGE_BRIDGE_PORT_CONTROL_MESSAGE,
            type: "disconnect",
            reason: "client-destroy",
            connectionId: current.connectionId,
          };

          try {
            current.port.postMessage(disconnectMessage);
            log(debug, logger, "rpc.control.disconnect.sent", {
              connectionId: current.connectionId,
            });
          } catch (error) {
            log(debug, logger, "rpc.control.disconnect.failed", {
              connectionId: current.connectionId,
              message: error instanceof Error ? error.message : String(error),
            });
          }

          try {
            await Effect.runPromise(
              Scope.close(current.scope, Exit.succeed(undefined)),
            );
          } catch {
            // ignored
          }

          try {
            current.port.close();
          } catch {
            // ignored
          }

          log(debug, logger, "rpc.destroyed", {
            connectionId: current.connectionId,
          });
        },
        catch: toRuntimeRpcError,
      }).pipe(Effect.catchAll(() => Effect.void));

      yield* Effect.addFinalizer(() => destroy);

      const createLanguageModel = (
        modelId: string,
        descriptor: BridgeModelDescriptorResponse,
      ): LanguageModelV3 => ({
        specificationVersion: descriptor.specificationVersion,
        provider: descriptor.provider,
        modelId: descriptor.modelId,
        supportedUrls: decodeSupportedUrls(descriptor.supportedUrls),
        async doGenerate(options) {
          sequence += 1;
          const requestId = nextRequestId(sequence);
          const abortSignal = options.abortSignal;

          if (abortSignal?.aborted) {
            throw createAbortError();
          }

          const onAbort = () => {
            void Effect.runPromise(abortRequest(requestId)).catch(
              () => undefined,
            );
          };

          abortSignal?.addEventListener("abort", onAbort, { once: true });

          try {
            const current = await Effect.runPromise(ensureConnection);
            const response = await Effect.runPromise(
              normalizeRpcError(
                current.client.modelDoGenerate({
                  requestId,
                  sessionID: requestId,
                  modelId,
                  options: encodeCallOptions(options),
                }),
              ),
            );

            return decodeGenerateResponse(response);
          } finally {
            abortSignal?.removeEventListener("abort", onAbort);
          }
        },
        async doStream(options) {
          sequence += 1;
          const requestId = nextRequestId(sequence);
          const abortSignal = options.abortSignal;

          if (abortSignal?.aborted) {
            throw createAbortError();
          }

          const current = await Effect.runPromise(ensureConnection);
          const runtimeStream = await Effect.runPromise(
            Effect.scoped(
              Stream.toReadableStreamEffect(
                normalizeRpcStreamError(
                  current.client.modelDoStream({
                    requestId,
                    sessionID: requestId,
                    modelId,
                    options: encodeCallOptions(options),
                  }),
                ),
              ),
            ),
          );

          const reader = runtimeStream.getReader();
          const onAbort = () => {
            void Effect.runPromise(abortRequest(requestId)).catch(
              () => undefined,
            );
          };

          abortSignal?.addEventListener("abort", onAbort, { once: true });

          const cleanup = () => {
            abortSignal?.removeEventListener("abort", onAbort);
          };

          return {
            stream: new ReadableStream<LanguageModelV3StreamPart>({
              async pull(controller) {
                const next = await reader.read();
                if (next.done) {
                  cleanup();
                  controller.close();
                  return;
                }
                controller.enqueue(decodeStreamPart(next.value));
              },
              async cancel() {
                try {
                  await reader.cancel();
                } finally {
                  cleanup();
                  void Effect.runPromise(abortRequest(requestId)).catch(
                    () => undefined,
                  );
                }
              },
            }),
          };
        },
      });

      const listModels = ensureConnection.pipe(
        Effect.flatMap((current) =>
          normalizeRpcError(current.client.listModels({})),
        ),
        Effect.map((response) => response.models),
      );

      const getState = ensureConnection.pipe(
        Effect.flatMap((current) =>
          normalizeRpcError(current.client.getState({})),
        ),
      );

      const requestPermission = (payload: BridgePermissionRequest = {}) =>
        ensureConnection.pipe(
          Effect.flatMap((current) =>
            normalizeRpcError(current.client.requestPermission(payload)),
          ),
        );

      const getModel = (modelId: string) =>
        Effect.gen(function* () {
          sequence += 1;
          const requestId = nextRequestId(sequence);
          const current = yield* ensureConnection;
          const descriptor = yield* normalizeRpcError(
            current.client.getModel({
              modelId,
              requestId,
              sessionID: requestId,
            }),
          );

          return createLanguageModel(modelId, descriptor);
        });

      return {
        listModels,
        getModel,
        getState,
        requestPermission,
        destroy,
      } satisfies BridgeClientApi;
    }),
  );
}

export function withBridgeClient<R, E, A>(
  effect: Effect.Effect<A, E, R | BridgeClient>,
  options: BridgeClientOptions = {},
): Effect.Effect<A, E, Exclude<R, BridgeClient>> {
  return effect.pipe(Effect.provide(BridgeClientLive(options)));
}

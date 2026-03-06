import type {
  JSONValue,
  JSONObject,
  LanguageModelV3CallOptions,
  LanguageModelV3GenerateResult,
  SharedV3ProviderMetadata,
  SharedV3ProviderOptions,
  SharedV3Warning,
} from "@ai-sdk/provider";
import {
  RuntimeValidationError,
  decodeRuntimeWireValue,
  encodeRuntimeWireValue,
  type JsonValue,
  type RuntimeGenerateResponse,
  type RuntimeModelCallOptions,
  type RuntimePromptMessage,
  type RuntimeUsage,
  type RuntimeWireDate,
  type RuntimeWireUint8Array,
  type RuntimeWireUrl,
} from "@llm-bridge/contracts";

export type ProviderPromptMessage =
  LanguageModelV3CallOptions["prompt"][number];
export type ProviderToolSpec = NonNullable<
  LanguageModelV3CallOptions["tools"]
>[number];

type RuntimeUserMessage = Extract<RuntimePromptMessage, { role: "user" }>;
type RuntimeAssistantMessage = Extract<
  RuntimePromptMessage,
  { role: "assistant" }
>;
type RuntimeToolMessage = Extract<RuntimePromptMessage, { role: "tool" }>;

export type ProviderUserPart = Extract<
  ProviderPromptMessage,
  { role: "user" }
>["content"][number];
export type ProviderAssistantPart = Extract<
  ProviderPromptMessage,
  { role: "assistant" }
>["content"][number];
export type ProviderToolPart = Extract<
  ProviderPromptMessage,
  { role: "tool" }
>["content"][number];
export type ProviderToolResultOutput = Extract<
  ProviderAssistantPart,
  { type: "tool-result" }
>["output"];

export type RuntimeUserPart = RuntimeUserMessage["content"][number];
export type RuntimeAssistantPart = RuntimeAssistantMessage["content"][number];
export type RuntimeToolPart = RuntimeToolMessage["content"][number];
export type RuntimeToolResultOutput = Extract<
  RuntimeAssistantPart,
  { type: "tool-result" }
>["output"];

export function assertNever(
  value: never,
  message = "Unexpected bridge codec variant",
): never {
  const candidate = value as unknown;
  const detail = isRecord(candidate)
    ? typeof candidate.type === "string"
      ? candidate.type
      : typeof candidate.role === "string"
        ? candidate.role
        : undefined
    : undefined;

  throw new RuntimeValidationError({
    message: detail ? `${message}: ${detail}` : message,
  });
}

export function isRecord(value: unknown): value is Record<string, unknown> {
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

function isWireDate(value: unknown): value is RuntimeWireDate {
  return (
    isRecord(value) &&
    value.__llmBridgeWireType === "date" &&
    typeof value.iso === "string"
  );
}

export function encodeDataContent(
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

export function decodeDataContent(
  value: string | RuntimeWireUrl | RuntimeWireUint8Array,
): string | URL | Uint8Array {
  if (typeof value === "string") {
    return value;
  }

  const decoded = decodeRuntimeWireValue(value);
  if (
    typeof decoded === "string" ||
    decoded instanceof URL ||
    decoded instanceof Uint8Array
  ) {
    return decoded;
  }

  throw new RuntimeValidationError({
    message: "Failed to decode prompt file data from runtime wire transport",
  });
}

export function encodeBinaryData(value: Uint8Array): RuntimeWireUint8Array {
  const encoded = encodeRuntimeWireValue(value);
  if (isWireUint8Array(encoded)) {
    return encoded;
  }

  throw new RuntimeValidationError({
    message: "Failed to encode binary value for runtime wire transport",
  });
}

export function decodeBinaryData(value: RuntimeWireUint8Array): Uint8Array {
  const decoded = decodeRuntimeWireValue(value);
  if (decoded instanceof Uint8Array) {
    return decoded;
  }

  throw new RuntimeValidationError({
    message:
      "Failed to decode generated binary data from runtime wire transport",
  });
}

export function encodeWireDate(
  value: Date | undefined,
): RuntimeWireDate | undefined {
  if (!value) {
    return undefined;
  }

  const encoded = encodeRuntimeWireValue(value);
  if (isWireDate(encoded)) {
    return encoded;
  }

  throw new RuntimeValidationError({
    message: "Failed to encode Date value for runtime wire transport",
  });
}

export function decodeWireDate(
  value: RuntimeWireDate | undefined,
): Date | undefined {
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

export function toContractJsonValue(value: JSONValue): JsonValue {
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

export function toContractJsonObject(value: JSONObject): {
  readonly [key: string]: JsonValue;
} {
  return toContractJsonValue(value) as { readonly [key: string]: JsonValue };
}

export function toProviderJsonValue(value: JsonValue): JSONValue {
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

export function toProviderJsonObject(value: {
  readonly [key: string]: JsonValue;
}): JSONObject {
  return toProviderJsonValue(value) as JSONObject;
}

export function toRuntimeProviderOptions(
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

export function fromRuntimeProviderOptions(
  value: RuntimeModelCallOptions["providerOptions"] | undefined,
): SharedV3ProviderOptions | undefined {
  if (!value) return undefined;

  return Object.fromEntries(
    Object.entries(value).map(([provider, options]) => [
      provider,
      toProviderJsonObject(options),
    ]),
  );
}

export function toRuntimeProviderMetadata(
  value: SharedV3ProviderMetadata | undefined,
): RuntimeGenerateResponse["providerMetadata"] {
  if (!value) return undefined;

  return Object.fromEntries(
    Object.entries(value).map(([provider, metadata]) => [
      provider,
      toContractJsonObject(metadata),
    ]),
  );
}

export function fromRuntimeProviderMetadata(
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

export function normalizeHeaders(
  headers: Record<string, string | undefined> | undefined,
): Record<string, string> | undefined {
  if (!headers) return undefined;

  const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value !== "string") continue;
    output[key] = value;
  }
  return output;
}

export function toProviderToolId(id: string): `${string}.${string}` {
  if (id.includes(".")) {
    return id as `${string}.${string}`;
  }

  return `bridge.${id}`;
}

export function toRuntimeUsage(
  usage: LanguageModelV3GenerateResult["usage"],
): RuntimeUsage {
  return {
    inputTokens: {
      total: usage.inputTokens.total,
      noCache: usage.inputTokens.noCache,
      cacheRead: usage.inputTokens.cacheRead,
      cacheWrite: usage.inputTokens.cacheWrite,
    },
    outputTokens: {
      total: usage.outputTokens.total,
      text: usage.outputTokens.text,
      reasoning: usage.outputTokens.reasoning,
    },
    raw: usage.raw ? toContractJsonObject(usage.raw) : undefined,
  };
}

export function fromRuntimeUsage(
  usage: RuntimeUsage,
): LanguageModelV3GenerateResult["usage"] {
  return {
    inputTokens: {
      total: usage.inputTokens.total,
      noCache: usage.inputTokens.noCache,
      cacheRead: usage.inputTokens.cacheRead,
      cacheWrite: usage.inputTokens.cacheWrite,
    },
    outputTokens: {
      total: usage.outputTokens.total,
      text: usage.outputTokens.text,
      reasoning: usage.outputTokens.reasoning,
    },
    raw: usage.raw ? toProviderJsonObject(usage.raw) : undefined,
  };
}

export function toRuntimeWarnings(
  warnings:
    | LanguageModelV3GenerateResult["warnings"]
    | ReadonlyArray<SharedV3Warning>,
): RuntimeGenerateResponse["warnings"] {
  return warnings.map((warning) => ({ ...warning }));
}

export function fromRuntimeWarnings(
  warnings: RuntimeGenerateResponse["warnings"],
): Array<SharedV3Warning> {
  return warnings.map((warning) => ({ ...warning })) as Array<SharedV3Warning>;
}

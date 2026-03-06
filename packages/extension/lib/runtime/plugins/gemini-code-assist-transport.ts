import {
  backoffDelayMs,
  createTransportFetchPipeline,
  parseRetryAfterMs,
} from "@/lib/runtime/ai/transport-pipeline";
import type { RewrittenTransportRequest } from "@/lib/runtime/ai/transport-pipeline";

const GENERATIVE_LANGUAGE_HOST = "generativelanguage.googleapis.com";
const CODE_ASSIST_BASE_URL = "https://cloudcode-pa.googleapis.com";
const STREAM_ACTION = "streamGenerateContent";

const MODEL_FALLBACKS: Record<string, string> = {
  "gemini-2.5-flash-image": "gemini-2.5-flash",
};

export const GEMINI_CODE_ASSIST_HEADERS = {
  "X-Goog-Api-Client": "gl-node/22.17.0",
  "Client-Metadata":
    "ideType=IDE_UNSPECIFIED,platform=PLATFORM_UNSPECIFIED,pluginType=GEMINI",
} as const;

export interface GeminiCodeAssistFetchOptions {
  projectId: string;
  fetchFn?: typeof fetch;
  maxAttempts?: number;
  baseRetryDelayMs?: number;
}

export interface GeminiRewriteMetadata {
  streaming: boolean;
  requestedModel: string;
}

function randomRequestID() {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function parseGoogleRetryDelayMs(value: unknown) {
  if (typeof value === "string") {
    const match = value.trim().match(/^(\d+)(?:\.(\d+))?s$/);
    if (!match) return undefined;
    const seconds = Number.parseInt(match[1] ?? "0", 10);
    const fractionRaw = match[2];
    const millis = fractionRaw
      ? Number.parseInt(fractionRaw.padEnd(3, "0").slice(0, 3), 10)
      : 0;
    return seconds * 1000 + millis;
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const secondsRaw = record.seconds;
    const nanosRaw = record.nanos;

    const seconds =
      typeof secondsRaw === "number"
        ? secondsRaw
        : typeof secondsRaw === "string"
          ? Number.parseInt(secondsRaw, 10)
          : 0;

    const nanos =
      typeof nanosRaw === "number"
        ? nanosRaw
        : typeof nanosRaw === "string"
          ? Number.parseInt(nanosRaw, 10)
          : 0;

    if (!Number.isFinite(seconds) || !Number.isFinite(nanos)) {
      return undefined;
    }

    return Math.max(0, seconds * 1000 + Math.floor(nanos / 1_000_000));
  }

  return undefined;
}

async function parseRetryInfoDelayMs(response: Response) {
  try {
    const body = (await response.clone().json()) as {
      error?: {
        details?: Array<Record<string, unknown>>;
      };
    };

    const details = body?.error?.details;
    if (!Array.isArray(details)) return undefined;

    for (const detail of details) {
      if (detail?.["@type"] !== "type.googleapis.com/google.rpc.RetryInfo") {
        continue;
      }

      const delay = parseGoogleRetryDelayMs(detail.retryDelay);
      if (typeof delay === "number") {
        return delay;
      }
    }
  } catch {
    return undefined;
  }

  return undefined;
}

async function resolveGeminiRetryDelayMs(
  response: Response,
  attempt: number,
  baseRetryDelayMs: number,
) {
  const headerDelay = parseRetryAfterMs(response.headers.get("Retry-After"));
  if (typeof headerDelay === "number") {
    return headerDelay;
  }

  const bodyDelay = await parseRetryInfoDelayMs(response);
  if (typeof bodyDelay === "number") {
    return bodyDelay;
  }

  return backoffDelayMs(attempt, baseRetryDelayMs);
}

function extractActionAndModel(url: string) {
  const match = url.match(/\/models\/(.+?):([a-zA-Z]+)(?:\?|$)/);
  if (!match) return undefined;
  const requestedModel = decodeURIComponent(match[1] ?? "");
  const action = match[2] ?? "";
  if (!requestedModel || !action) return undefined;

  const effectiveModel = MODEL_FALLBACKS[requestedModel] ?? requestedModel;
  const streaming = action === STREAM_ACTION;

  return {
    action,
    requestedModel,
    effectiveModel,
    streaming,
  };
}

function getAuthorizationHeader(headers: Headers) {
  const token = headers.get("authorization") ?? headers.get("Authorization");
  if (!token) return undefined;
  return token.trim() || undefined;
}

function transformRequestPayload(
  input: unknown,
  projectId: string,
  model: string,
) {
  if (!input || typeof input !== "object") {
    throw new Error("Gemini OAuth request body must be a JSON object.");
  }

  const body = { ...(input as Record<string, unknown>) };

  if (
    typeof body.project === "string" &&
    body.request &&
    typeof body.request === "object"
  ) {
    return {
      ...body,
      project: projectId,
      model,
    };
  }

  const userPromptId =
    (typeof body.user_prompt_id === "string" && body.user_prompt_id) ||
    (typeof body.userPromptId === "string" && body.userPromptId) ||
    randomRequestID();

  delete body.user_prompt_id;
  delete body.userPromptId;
  delete body.model;

  return {
    project: projectId,
    model,
    user_prompt_id: userPromptId,
    request: body,
  };
}

export function isGenerativeLanguageRequest(url: string) {
  return url.includes(GENERATIVE_LANGUAGE_HOST);
}

export async function rewriteGeminiCodeAssistRequest(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  options: {
    projectId: string;
  },
): Promise<RewrittenTransportRequest<GeminiRewriteMetadata> | null> {
  const request = new Request(input, init);
  const url = request.url;

  if (!isGenerativeLanguageRequest(url)) {
    return null;
  }

  const parsed = extractActionAndModel(url);
  if (!parsed) {
    return null;
  }

  const authorization = getAuthorizationHeader(request.headers);
  if (!authorization) {
    throw new Error(
      "Gemini OAuth bearer token is missing from request headers.",
    );
  }

  const headers = new Headers(request.headers);
  headers.set("Authorization", authorization);
  headers.delete("x-api-key");
  headers.delete("x-goog-api-key");
  headers.delete("content-length");

  for (const [key, value] of Object.entries(GEMINI_CODE_ASSIST_HEADERS)) {
    headers.set(key, value);
  }

  if (parsed.streaming) {
    headers.set("Accept", "text/event-stream");
  }

  let bodyText = "";
  if (request.method !== "GET" && request.method !== "HEAD") {
    bodyText = await request.text();
  }

  const nextBody = (() => {
    if (request.method === "GET" || request.method === "HEAD") {
      return undefined;
    }

    if (!bodyText) {
      throw new Error("Gemini OAuth request body is empty.");
    }

    const parsedBody = JSON.parse(bodyText) as unknown;
    const wrapped = transformRequestPayload(
      parsedBody,
      options.projectId,
      parsed.effectiveModel,
    );
    return JSON.stringify(wrapped);
  })();

  const transformedURL = `${CODE_ASSIST_BASE_URL}/v1internal:${parsed.action}${
    parsed.streaming ? "?alt=sse" : ""
  }`;

  return {
    request: transformedURL,
    init: {
      method: request.method,
      headers,
      body: nextBody,
      signal: init?.signal,
    },
    metadata: {
      streaming: parsed.streaming,
      requestedModel: parsed.requestedModel,
    },
  };
}

export function transformGeminiCodeAssistSSELine(line: string): string {
  if (!line.startsWith("data:")) {
    return line;
  }

  const payload = line.slice(5).trim();
  if (!payload) {
    return line;
  }

  try {
    const parsed = JSON.parse(payload) as Record<string, unknown>;
    const responsePayload = parsed.response;
    if (!responsePayload || typeof responsePayload !== "object") {
      return line;
    }

    if (typeof parsed.traceId === "string") {
      const responseRecord = responsePayload as Record<string, unknown>;
      if (
        typeof responseRecord.responseId !== "string" ||
        !responseRecord.responseId
      ) {
        responseRecord.responseId = parsed.traceId;
      }
    }

    return `data: ${JSON.stringify(responsePayload)}`;
  } catch {
    return line;
  }
}

function transformGeminiCodeAssistStream(stream: ReadableStream<Uint8Array>) {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";

  return new ReadableStream<Uint8Array>({
    start(controller) {
      const reader = stream.getReader();

      const pump = (): void => {
        reader
          .read()
          .then(({ done, value }) => {
            if (done) {
              buffer += decoder.decode();
              if (buffer.length > 0) {
                controller.enqueue(
                  encoder.encode(transformGeminiCodeAssistSSELine(buffer)),
                );
              }
              controller.close();
              return;
            }

            buffer += decoder.decode(value, { stream: true });
            let newlineIndex = buffer.indexOf("\n");

            while (newlineIndex !== -1) {
              const rawLine = buffer.slice(0, newlineIndex);
              buffer = buffer.slice(newlineIndex + 1);

              const hasCR = rawLine.endsWith("\r");
              const line = hasCR ? rawLine.slice(0, -1) : rawLine;
              const transformed = transformGeminiCodeAssistSSELine(line);
              controller.enqueue(
                encoder.encode(`${transformed}${hasCR ? "\r\n" : "\n"}`),
              );

              newlineIndex = buffer.indexOf("\n");
            }

            pump();
          })
          .catch((error) => {
            controller.error(error);
          });
      };

      pump();
    },
  });
}

function unwrapGeminiCodeAssistPayload(payload: Record<string, unknown>) {
  const response = payload.response;
  if (!response || typeof response !== "object") {
    return payload;
  }

  const responseRecord = response as Record<string, unknown>;
  if (typeof payload.traceId === "string") {
    if (
      typeof responseRecord.responseId !== "string" ||
      !responseRecord.responseId
    ) {
      responseRecord.responseId = payload.traceId;
    }
  }

  return responseRecord;
}

export async function normalizeGeminiCodeAssistResponse(
  response: Response,
  metadata: GeminiRewriteMetadata,
): Promise<Response> {
  const contentType = response.headers.get("content-type") ?? "";
  const headers = new Headers(response.headers);
  headers.delete("content-length");

  if (
    metadata.streaming &&
    contentType.includes("text/event-stream") &&
    response.body
  ) {
    return new Response(transformGeminiCodeAssistStream(response.body), {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  if (!contentType.includes("application/json")) {
    return response;
  }

  const text = await response.text();
  if (!text) {
    return new Response(text, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const unwrapped = unwrapGeminiCodeAssistPayload(parsed);

    if (unwrapped === parsed) {
      return new Response(text, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    }

    return new Response(JSON.stringify(unwrapped), {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  } catch {
    return new Response(text, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }
}

export function createGeminiCodeAssistFetch(
  options: GeminiCodeAssistFetchOptions,
): typeof fetch {
  return createTransportFetchPipeline({
    fetchFn: options.fetchFn,
    maxAttempts: options.maxAttempts,
    baseRetryDelayMs: options.baseRetryDelayMs,
    rewriteRequest: (input, init) =>
      rewriteGeminiCodeAssistRequest(input, init, {
        projectId: options.projectId,
      }),
    normalizeResponse: normalizeGeminiCodeAssistResponse,
    resolveRetryDelayMs: resolveGeminiRetryDelayMs,
  });
}

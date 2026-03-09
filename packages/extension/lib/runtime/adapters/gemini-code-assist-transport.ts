import { z } from "zod";
import type { RuntimeFetch } from "./types";

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

interface GeminiCodeAssistFetchOptions {
  projectId: string;
  fetchFn?: RuntimeFetch;
}

interface GeminiRewriteMetadata {
  streaming: boolean;
  requestedModel: string;
}

interface RewrittenTransportRequest<TMetadata = void> {
  request: RequestInfo | URL;
  init: RequestInit;
  metadata: TMetadata;
}

const jsonRecordSchema: z.ZodType<Record<string, unknown>> = z.record(
  z.string(),
  z.unknown(),
);

const geminiResponseEnvelopeSchema = z.object({
  traceId: z.string().optional(),
  response: jsonRecordSchema.optional(),
});

function randomRequestID() {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
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
  input: Record<string, unknown>,
  projectId: string,
  model: string,
) {
  const body = { ...input };

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

function isGenerativeLanguageRequest(url: string) {
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

    const parsedJson = JSON.parse(bodyText) as unknown;
    const parsedBodyResult = jsonRecordSchema.safeParse(parsedJson);
    if (!parsedBodyResult.success) {
      throw new Error("Gemini OAuth request body must be a JSON object.");
    }
    const wrapped = transformRequestPayload(
      parsedBodyResult.data,
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

function transformGeminiCodeAssistSSELine(line: string): string {
  if (!line.startsWith("data:")) {
    return line;
  }

  const payload = line.slice(5).trim();
  if (!payload) {
    return line;
  }

  try {
    const parsedResult = geminiResponseEnvelopeSchema.safeParse(
      JSON.parse(payload) as unknown,
    );
    if (!parsedResult.success || !parsedResult.data.response) {
      return line;
    }

    const { traceId, response } = parsedResult.data;
    if (typeof traceId === "string") {
      if (
        typeof response.responseId !== "string" ||
        !response.responseId
      ) {
        response.responseId = traceId;
      }
    }

    return `data: ${JSON.stringify(response)}`;
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
  const parsedResult = geminiResponseEnvelopeSchema.safeParse(payload);
  if (!parsedResult.success || !parsedResult.data.response) {
    return payload;
  }

  const { traceId, response } = parsedResult.data;
  if (typeof traceId === "string") {
    if (
      typeof response.responseId !== "string" ||
      !response.responseId
    ) {
      response.responseId = traceId;
    }
  }

  return response;
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
    const parsedResult = jsonRecordSchema.safeParse(JSON.parse(text) as unknown);
    if (!parsedResult.success) {
      return new Response(text, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    }

    const unwrapped = unwrapGeminiCodeAssistPayload(parsedResult.data);

    if (unwrapped === parsedResult.data) {
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
): RuntimeFetch {
  const fetchFn = options.fetchFn ?? fetch;

  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const rewritten = await rewriteGeminiCodeAssistRequest(input, init, {
      projectId: options.projectId,
    });

    if (!rewritten) {
      return fetchFn(input, init);
    }

    const response = await fetchFn(rewritten.request, rewritten.init);
    return normalizeGeminiCodeAssistResponse(response, rewritten.metadata);
  }) as RuntimeFetch;
}

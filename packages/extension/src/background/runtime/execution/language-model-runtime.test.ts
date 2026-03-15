import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mock } from "@/test-utils/vitest-compat";
import { APICallError } from "@ai-sdk/provider";
import { RuntimeUpstreamServiceError } from "@llm-bridge/contracts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

const getAuthMock = mock((_providerID?: string) => ({
  type: "api" as const,
  key: "token-1",
}));
const setAuthMock = mock((_providerID?: string, _value?: unknown) => undefined);
const removeAuthMock = mock((_providerID?: string) => undefined);

const getProviderMock = mock(async () => ({
  id: "openai",
  name: "OpenAI",
  source: "models.dev" as const,
  env: [],
  connected: true,
  options: {},
}));

const getModelMock = mock(async () => ({
  id: "openai/gpt-4o-mini",
  providerID: "openai",
  name: "GPT-4o mini",
  status: "active" as const,
  api: {
    id: "gpt-4o-mini",
    url: "https://api.openai.com/v1",
    npm: "@ai-sdk/openai",
  },
  cost: {
    input: 0,
    output: 0,
    cache: {
      read: 0,
      write: 0,
    },
  },
  limit: {
    context: 1,
    output: 1,
  },
  options: {},
  headers: {},
  capabilities: {
    temperature: true,
    reasoning: false,
    attachment: false,
    toolcall: false,
    code: true,
    input: {
      text: true,
      audio: false,
      image: false,
      video: false,
      pdf: false,
    },
    output: {
      text: true,
      audio: false,
      image: false,
      video: false,
      pdf: false,
    },
  },
}));

const doGenerateMock = mock(async () => {
  throw new APICallError({
    message: "Rate limited",
    url: "https://api.openai.com/v1/responses",
    requestBodyValues: {},
    statusCode: 429,
    responseHeaders: {
      "retry-after-ms": "1500",
    },
    isRetryable: true,
  });
});

const doStreamMock = mock(async (): Promise<{ stream: ReadableStream<unknown> }> => {
  throw new APICallError({
    message: "Overloaded",
    url: "https://api.openai.com/v1/responses",
    requestBodyValues: {},
    statusCode: 503,
    responseHeaders: {
      "retry-after": "2",
    },
    isRetryable: true,
  });
});

let supportedUrlsValue: Record<string, RegExp[]> = {};
let supportedUrlsError: Error | null = null;
const originalConsoleLog = console.log;
const originalConsoleError = console.error;

const adapter = {
  createModel: mock(() =>
    Effect.succeed({
      provider: "openai",
      modelId: "gpt-4o-mini",
      specificationVersion: "v3",
      get supportedUrls() {
        if (supportedUrlsError) {
          throw supportedUrlsError;
        }
        return supportedUrlsValue;
      },
      doGenerate: doGenerateMock,
      doStream: doStreamMock,
    }),
  ),
};

type LanguageModelRuntimeModule =
  typeof import("@/background/runtime/execution/language-model-runtime");

let languageModelRuntimeModule: LanguageModelRuntimeModule;

function installLanguageModelRuntimeMocks() {
  mock.module("@/background/runtime/auth/auth-store", () => ({
    getAuth: () => Effect.sync(() => getAuthMock()),
    setAuth: (providerID: string, value: unknown) =>
      Effect.sync(() => setAuthMock(providerID, value)),
    removeAuth: (providerID: string) =>
      Effect.sync(() => removeAuthMock(providerID)),
    runSecurityEffect: <A>(effect: Effect.Effect<A>) => Effect.runPromise(effect),
  }));

  mock.module("@/background/runtime/catalog/provider-registry", () => ({
    getProvider: () => Effect.promise(() => getProviderMock()),
    getModel: () => Effect.promise(() => getModelMock()),
    listModelRows: mock(() => Effect.succeed([])),
    listProviderRows: mock(() => Effect.succeed([])),
    ensureProviderCatalog: mock(() => Effect.void),
    refreshProviderCatalog: mock(() => Effect.succeed(Date.now())),
    refreshProviderCatalogForProvider: mock(() => Effect.void),
  }));

  mock.module("@/background/runtime/providers/adapters", () => ({
    resolveAdapterForProvider: () => adapter,
    resolveAdapterForModel: () => adapter,
    parseAdapterStoredAuth: () => ({
      type: "api" as const,
      key: "token-1",
      methodID: "apikey",
      methodType: "apikey",
    }),
  }));
}

async function loadLanguageModelRuntimeModule() {
  installLanguageModelRuntimeMocks();
  return import("@/background/runtime/execution/language-model-runtime");
}

beforeEach(async () => {
  getAuthMock.mockClear();
  setAuthMock.mockClear();
  removeAuthMock.mockClear();
  getProviderMock.mockClear();
  getModelMock.mockClear();
  doGenerateMock.mockClear();
  doStreamMock.mockClear();
  adapter.createModel.mockClear();
  supportedUrlsValue = {};
  supportedUrlsError = null;
  console.log = mock(() => undefined) as typeof console.log;
  console.error = mock(() => undefined) as typeof console.error;
  languageModelRuntimeModule = await loadLanguageModelRuntimeModule();
});

afterEach(() => {
  console.log = originalConsoleLog;
  console.error = originalConsoleError;
  mock.restore();
});

describe("language-model-runtime error normalization", () => {
  it("returns supportedUrls in the runtime model descriptor", async () => {
    supportedUrlsValue = {
      "image/*": [/^https:\/\/files\.openai\.com\/.*$/],
    };

    const result = await Effect.runPromise(
      languageModelRuntimeModule.getRuntimeModelDescriptor({
        modelID: "openai/gpt-4o-mini",
        origin: "https://example.test",
        sessionID: "session-1",
        requestID: "request-describe",
      }),
    );

    expect(result).toEqual({
      provider: "openai",
      modelId: "openai/gpt-4o-mini",
      supportedUrls: supportedUrlsValue,
    });
  });

  it("wraps provider-style descriptor failures as RuntimeUpstreamServiceError", async () => {
    supportedUrlsError = new APICallError({
      message: "Describe failed",
      url: "https://api.openai.com/v1/models/gpt-4o-mini",
      requestBodyValues: {},
      statusCode: 429,
      responseHeaders: {
        "retry-after": "1",
      },
      isRetryable: true,
    });

    const result = await Effect.runPromise(
      Effect.either(
        languageModelRuntimeModule.getRuntimeModelDescriptor({
          modelID: "openai/gpt-4o-mini",
          origin: "https://example.test",
          sessionID: "session-1",
          requestID: "request-describe",
        }),
      ),
    );

    expect("left" in result).toBe(true);
    if ("left" in result) {
      expect(result.left).toMatchObject({
        _tag: "RuntimeUpstreamServiceError",
        providerID: "openai",
        operation: "describe",
        statusCode: 429,
        responseHeaders: {
          "retry-after": "1",
        },
        retryable: true,
        message: "Describe failed",
      } satisfies Partial<RuntimeUpstreamServiceError>);
    }
  });

  it("wraps generate provider failures as RuntimeUpstreamServiceError", async () => {
    const result = await Effect.runPromise(
      Effect.either(
        languageModelRuntimeModule.runLanguageModelGenerate({
          modelID: "openai/gpt-4o-mini",
          origin: "https://example.test",
          sessionID: "session-1",
          requestID: "request-1",
          options: {
            prompt: [
              {
                role: "user",
                content: [{ type: "text", text: "hello" }],
              },
            ],
          },
        }),
      ),
    );

    expect("left" in result).toBe(true);
    if ("left" in result) {
      expect(result.left).toMatchObject({
        _tag: "RuntimeUpstreamServiceError",
        providerID: "openai",
        operation: "generate",
        statusCode: 429,
        responseHeaders: {
          "retry-after-ms": "1500",
        },
        retryable: true,
        message: "Rate limited",
      } satisfies Partial<RuntimeUpstreamServiceError>);
    }
  });

  it("wraps stream provider failures as RuntimeUpstreamServiceError", async () => {
    const result = await Effect.runPromise(
      Effect.either(
        languageModelRuntimeModule.runLanguageModelStream({
          modelID: "openai/gpt-4o-mini",
          origin: "https://example.test",
          sessionID: "session-1",
          requestID: "request-2",
          options: {
            prompt: [
              {
                role: "user",
                content: [{ type: "text", text: "hello" }],
              },
            ],
          },
        }),
      ),
    );

    expect("left" in result).toBe(true);
    if ("left" in result) {
      expect(result.left).toMatchObject({
        _tag: "RuntimeUpstreamServiceError",
        providerID: "openai",
        operation: "stream",
        statusCode: 503,
        responseHeaders: {
          "retry-after": "2",
        },
        retryable: true,
        message: "Overloaded",
      } satisfies Partial<RuntimeUpstreamServiceError>);
    }
  });

  it("wraps provider-style stream read failures inside the runtime stream", async () => {
    doStreamMock.mockImplementationOnce(async () => ({
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({
            type: "text-start",
            id: "text-1",
          });
          controller.error(
            new APICallError({
              message: "Stream read failed",
              url: "https://api.openai.com/v1/responses",
              requestBodyValues: {},
              statusCode: 502,
              responseHeaders: {
                "retry-after": "3",
              },
              isRetryable: true,
            }),
          );
        },
      }),
    }));

    const result = await Effect.runPromise(
      Effect.either(
        Effect.flatMap(
          languageModelRuntimeModule.runLanguageModelStream({
            modelID: "openai/gpt-4o-mini",
            origin: "https://example.test",
            sessionID: "session-1",
            requestID: "request-3",
            options: {
              prompt: [
                {
                  role: "user",
                  content: [{ type: "text", text: "hello" }],
                },
              ],
            },
          }),
          (stream) => Stream.runCollect(stream),
        ),
      ),
    );

    expect("left" in result).toBe(true);
    if ("left" in result) {
      expect(result.left).toMatchObject({
        _tag: "RuntimeUpstreamServiceError",
        providerID: "openai",
        operation: "stream",
        statusCode: 502,
        responseHeaders: {
          "retry-after": "3",
        },
        retryable: true,
        message: "Stream read failed",
      } satisfies Partial<RuntimeUpstreamServiceError>);
    }
  });

  it("redacts prompt bodies and headers from runtime model logs", async () => {
    await Effect.runPromise(
      Effect.either(
        languageModelRuntimeModule.runLanguageModelGenerate({
          modelID: "openai/gpt-4o-mini",
          origin: "https://example.test",
          sessionID: "session-1",
          requestID: "request-4",
          options: {
            prompt: [
              {
                role: "user",
                content: [{ type: "text", text: "super secret prompt" }],
              },
            ],
            headers: {
              authorization: "Bearer super-secret-token",
            },
          },
        }),
      ),
    );

    const serializedLogs = JSON.stringify([
      ...(console.log as ReturnType<typeof mock>).mock.calls,
      ...(console.error as ReturnType<typeof mock>).mock.calls,
    ]);

    expect(serializedLogs).not.toContain("super secret prompt");
    expect(serializedLogs).not.toContain("Bearer super-secret-token");
    expect(serializedLogs).toContain("promptMessageCount");
    expect(serializedLogs).toContain("hasHeaders");
  });
});

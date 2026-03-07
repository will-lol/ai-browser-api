import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { APICallError } from "@ai-sdk/provider";
import { RuntimeUpstreamServiceError } from "@llm-bridge/contracts";

const getAuthMock = mock(async () => ({
  type: "api" as const,
  key: "token-1",
}));
const setAuthMock = mock(async () => undefined);
const removeAuthMock = mock(async () => undefined);

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

const doStreamMock = mock(async () => {
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

const pluginManager = {
  loadAuthOptions: mock(async () => ({
    requestOptions: {},
    transport: {},
  })),
  applyAdapterState: mock(async (_ctx: unknown, state: any) => ({
    ...state,
    factory: {
      npm: "test-factory",
      factory: () => ({
        languageModel: () => ({
          provider: "openai",
          doGenerate: doGenerateMock,
          doStream: doStreamMock,
        }),
      }),
    },
  })),
  applyAdapterFactoryOptions: mock(async (_ctx: unknown, options: unknown) => options),
  validateAdapterState: mock(async () => undefined),
  applyChatParams: mock(async (_ctx: unknown, options: unknown) => options),
  applyRequestOptions: mock(async (_ctx: unknown, options: unknown) => options),
  applyChatHeaders: mock(async (_ctx: unknown, headers: unknown) => headers),
};

mock.module("@/lib/runtime/auth-store", () => ({
  getAuth: getAuthMock,
  setAuth: setAuthMock,
  removeAuth: removeAuthMock,
}));

mock.module("@/lib/runtime/provider-registry", () => ({
  getProvider: getProviderMock,
  getModel: getModelMock,
  listModelRows: mock(async () => []),
  listProviderRows: mock(async () => []),
  ensureProviderCatalog: mock(async () => undefined),
  refreshProviderCatalog: mock(async () => undefined),
  refreshProviderCatalogForProvider: mock(async () => undefined),
}));

mock.module("@/lib/runtime/plugins", () => ({
  getPluginManager: () => pluginManager,
}));

const { runLanguageModelGenerate, runLanguageModelStream } = await import(
  "@/lib/runtime/ai/language-model-runtime"
);

beforeEach(() => {
  getAuthMock.mockClear();
  setAuthMock.mockClear();
  removeAuthMock.mockClear();
  getProviderMock.mockClear();
  getModelMock.mockClear();
  doGenerateMock.mockClear();
  doStreamMock.mockClear();
  pluginManager.loadAuthOptions.mockClear();
  pluginManager.applyAdapterState.mockClear();
  pluginManager.applyAdapterFactoryOptions.mockClear();
  pluginManager.validateAdapterState.mockClear();
  pluginManager.applyChatParams.mockClear();
  pluginManager.applyRequestOptions.mockClear();
  pluginManager.applyChatHeaders.mockClear();
});

afterAll(() => {
  mock.restore();
});

describe("language-model-runtime error normalization", () => {
  it("wraps generate provider failures as RuntimeUpstreamServiceError", async () => {
    await expect(
      runLanguageModelGenerate({
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
    ).rejects.toMatchObject({
      _tag: "RuntimeUpstreamServiceError",
      providerID: "openai",
      operation: "generate",
      statusCode: 429,
      retryAfter: 1.5,
      retryable: true,
      message: "Rate limited",
    } satisfies Partial<RuntimeUpstreamServiceError>);
  });

  it("wraps stream provider failures as RuntimeUpstreamServiceError", async () => {
    await expect(
      runLanguageModelStream({
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
    ).rejects.toMatchObject({
      _tag: "RuntimeUpstreamServiceError",
      providerID: "openai",
      operation: "stream",
      statusCode: 503,
      retryAfter: 2,
      retryable: true,
      message: "Overloaded",
    } satisfies Partial<RuntimeUpstreamServiceError>);
  });
});

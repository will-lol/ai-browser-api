import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { APICallError } from "@ai-sdk/provider";
import { RuntimeUpstreamServiceError } from "@llm-bridge/contracts";
import * as Effect from "effect/Effect";

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

const adapter = {
  createModel: mock(() => Effect.succeed({
    provider: "openai",
    modelId: "gpt-4o-mini",
    specificationVersion: "v3",
    doGenerate: doGenerateMock,
    doStream: doStreamMock,
  })),
};

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
  resolveAdapterForModel: () => adapter,
  parseAdapterStoredAuth: () => ({
    type: "api" as const,
    key: "token-1",
    methodID: "apikey",
    methodType: "apikey",
  }),
}));

const { runLanguageModelGenerate, runLanguageModelStream } =
  await import("@/background/runtime/execution/language-model-runtime");

beforeEach(() => {
  getAuthMock.mockClear();
  setAuthMock.mockClear();
  removeAuthMock.mockClear();
  getProviderMock.mockClear();
  getModelMock.mockClear();
  doGenerateMock.mockClear();
  doStreamMock.mockClear();
  adapter.createModel.mockClear();
});

afterAll(() => {
  mock.restore();
});

describe("language-model-runtime error normalization", () => {
  it("wraps generate provider failures as RuntimeUpstreamServiceError", async () => {
    const result = await Effect.runPromise(
      Effect.either(
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
});

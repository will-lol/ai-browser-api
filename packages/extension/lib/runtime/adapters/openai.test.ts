import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  mock,
} from "bun:test";
import { resolveOpenAIExecutionState } from "@/lib/runtime/adapters/openai";
import type { RuntimeAdapterContext } from "@/lib/runtime/adapters/types";

function makeJwt(claims: Record<string, unknown>) {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none", typ: "JWT" })}.${encode(claims)}.`;
}

function createContext(): Omit<RuntimeAdapterContext, "auth" | "authStore"> {
  return {
    providerID: "openai",
    modelID: "gpt-4o-mini",
    origin: "https://example.test",
    sessionID: "session-1",
    requestID: "request-1",
    provider: {
      id: "openai",
      name: "OpenAI",
      source: "models.dev",
      env: ["OPENAI_API_KEY"],
      connected: true,
      options: {},
    },
    model: {
      id: "gpt-4o-mini",
      providerID: "openai",
      name: "GPT-4o mini",
      status: "active",
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
        toolcall: true,
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
    },
    runtime: {
      now: () => Date.now(),
    },
  };
}

describe("resolveOpenAIExecutionState", () => {
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  const setAuthMock = mock(async (_auth: unknown) => undefined);

  afterAll(() => {
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
  });

  beforeEach(() => {
    setAuthMock.mockClear();
    console.warn = mock(() => undefined);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
  });

  it("uses refreshed account id for header and persisted auth", async () => {
    globalThis.fetch = mock(
      async () =>
        new Response(
          JSON.stringify({
            access_token: "refreshed-access",
            refresh_token: "refreshed-refresh",
            expires_in: 1800,
            id_token: makeJwt({ chatgpt_account_id: "acct-new" }),
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
    ) as unknown as typeof fetch;

    const output = await resolveOpenAIExecutionState({
      ...createContext(),
      auth: {
        type: "oauth",
        methodID: "oauth-device",
        methodType: "oauth",
        access: "stale-access",
        refresh: "stale-refresh",
        expiresAt: Date.now() - 1_000,
        accountId: "acct-old",
        metadata: { accountId: "acct-old" },
        createdAt: Date.now() - 10_000,
        updatedAt: Date.now() - 10_000,
      },
      authStore: {
        get: async () => undefined,
        set: setAuthMock,
        remove: async () => undefined,
      },
    });

    expect(output.apiKey).toBe("refreshed-access");
    const headers = output.headers as Record<string, string | undefined>;
    expect(headers["chatgpt-account-id"]).toBe("acct-new");

    expect(setAuthMock).toHaveBeenCalledTimes(1);
    const payload = setAuthMock.mock.calls[0]?.[0] as
      | { accountId?: string; metadata?: { accountId?: string } }
      | undefined;
    expect(payload?.accountId).toBe("acct-new");
    expect(payload?.metadata).toEqual({ accountId: "acct-new" });
  });

  it("keeps prior account id when refreshed token has no claim", async () => {
    globalThis.fetch = mock(
      async () =>
        new Response(
          JSON.stringify({
            access_token: "refreshed-access",
            refresh_token: "refreshed-refresh",
            expires_in: 1800,
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
    ) as unknown as typeof fetch;

    const output = await resolveOpenAIExecutionState({
      ...createContext(),
      auth: {
        type: "oauth",
        methodID: "oauth-device",
        methodType: "oauth",
        access: "stale-access",
        refresh: "stale-refresh",
        expiresAt: Date.now() - 1_000,
        accountId: "acct-existing",
        metadata: { accountId: "acct-existing" },
        createdAt: Date.now() - 10_000,
        updatedAt: Date.now() - 10_000,
      },
      authStore: {
        get: async () => undefined,
        set: setAuthMock,
        remove: async () => undefined,
      },
    });

    const headers = output.headers as Record<string, string | undefined>;
    expect(headers["chatgpt-account-id"]).toBe("acct-existing");
    const payload = setAuthMock.mock.calls[0]?.[0] as
      | { accountId?: string; metadata?: { accountId?: string } }
      | undefined;
    expect(payload?.accountId).toBe("acct-existing");
    expect(payload?.metadata).toEqual({ accountId: "acct-existing" });
  });

  it("omits header and warns when account id remains missing after refresh", async () => {
    globalThis.fetch = mock(
      async () =>
        new Response(
          JSON.stringify({
            access_token: "refreshed-access",
            refresh_token: "refreshed-refresh",
            expires_in: 1800,
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
    ) as unknown as typeof fetch;

    const output = await resolveOpenAIExecutionState({
      ...createContext(),
      auth: {
        type: "oauth",
        methodID: "oauth-device",
        methodType: "oauth",
        access: "stale-access",
        refresh: "stale-refresh",
        expiresAt: Date.now() - 1_000,
        createdAt: Date.now() - 10_000,
        updatedAt: Date.now() - 10_000,
      },
      authStore: {
        get: async () => undefined,
        set: setAuthMock,
        remove: async () => undefined,
      },
    });

    const headers = output.headers as Record<string, string | undefined>;
    expect(headers["chatgpt-account-id"]).toBeUndefined();
    expect(setAuthMock).toHaveBeenCalledTimes(1);
    const payload = setAuthMock.mock.calls[0]?.[0] as
      | { accountId?: string; metadata?: { accountId?: string } }
      | undefined;
    expect(payload?.accountId).toBeUndefined();
    expect(payload?.metadata).toBeUndefined();
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it("keeps existing behavior when refresh is not needed", async () => {
    const fetchMock = mock(async () => {
      throw new Error("fetch should not be called");
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const output = await resolveOpenAIExecutionState({
      ...createContext(),
      auth: {
        type: "oauth",
        methodID: "oauth-device",
        methodType: "oauth",
        access: "current-access",
        refresh: "refresh-token",
        expiresAt: Date.now() + 30 * 60_000,
        accountId: "acct-steady",
        metadata: { accountId: "acct-steady" },
        createdAt: Date.now() - 10_000,
        updatedAt: Date.now() - 10_000,
      },
      authStore: {
        get: async () => undefined,
        set: setAuthMock,
        remove: async () => undefined,
      },
    });

    expect(output.apiKey).toBe("current-access");
    const headers = output.headers as Record<string, string | undefined>;
    expect(headers["chatgpt-account-id"]).toBe("acct-steady");
    expect(fetchMock).toHaveBeenCalledTimes(0);
    expect(setAuthMock).toHaveBeenCalledTimes(0);
    expect(console.warn).toHaveBeenCalledTimes(0);
  });
});

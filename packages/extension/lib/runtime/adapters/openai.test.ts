import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  mock,
} from "bun:test";
import {
  loadCodexOAuthState,
  openaiAdapter,
} from "@/lib/runtime/adapters/openai";
import type { AdapterAuthContext } from "@/lib/runtime/adapters/types";

const setAuthMock = mock(async () => undefined);
mock.module("@/lib/runtime/auth-store", () => ({
  setAuth: setAuthMock,
}));

function createContext(): AdapterAuthContext {
  return {
    providerID: "openai",
    provider: {
      id: "openai",
      name: "OpenAI",
      source: "models.dev",
      env: ["OPENAI_API_KEY"],
      connected: true,
      options: {},
    },
  };
}

function makeJwt(claims: Record<string, unknown>) {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none", typ: "JWT" })}.${encode(claims)}.`;
}

describe("loadCodexOAuthState", () => {
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;

  afterAll(() => {
    mock.restore();
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
    );

    const output = await loadCodexOAuthState({
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
    });

    expect(output.transport.apiKey).toBe("refreshed-access");
    expect(output.transport.headers?.["chatgpt-account-id"]).toBe("acct-new");

    expect(setAuthMock).toHaveBeenCalledTimes(1);
    const [, payload] = setAuthMock.mock.calls[0];
    expect(payload.accountId).toBe("acct-new");
    expect(payload.metadata.accountId).toBe("acct-new");
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
    );

    const output = await loadCodexOAuthState({
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
    });

    expect(output.transport.headers?.["chatgpt-account-id"]).toBe(
      "acct-existing",
    );
    const [, payload] = setAuthMock.mock.calls[0];
    expect(payload.accountId).toBe("acct-existing");
    expect(payload.metadata.accountId).toBe("acct-existing");
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
    );

    const output = await loadCodexOAuthState({
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
    });

    expect(output.transport.headers?.["chatgpt-account-id"]).toBeUndefined();
    expect(setAuthMock).toHaveBeenCalledTimes(1);
    const [, payload] = setAuthMock.mock.calls[0];
    expect(payload.accountId).toBeUndefined();
    expect(payload.metadata).toBeUndefined();

    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledWith(
      "[adapter:openai] oauth accountId is missing; Codex requests may fail until token claims include chatgpt_account_id.",
    );
  });

  it("keeps existing behavior when refresh is not needed", async () => {
    const fetchMock = mock(async () => {
      throw new Error("fetch should not be called");
    });
    globalThis.fetch = fetchMock;

    const output = await loadCodexOAuthState({
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
    });

    expect(output.transport.apiKey).toBe("current-access");
    expect(output.transport.headers?.["chatgpt-account-id"]).toBe(
      "acct-steady",
    );
    expect(fetchMock).toHaveBeenCalledTimes(0);
    expect(setAuthMock).toHaveBeenCalledTimes(0);
    expect(console.warn).toHaveBeenCalledTimes(0);
  });
});

describe("openaiAdapter.auth.parseStoredAuth", () => {
  it("normalizes oauth records into the current method-aware shape", () => {
    const parsed = openaiAdapter.auth.parseStoredAuth({
      type: "oauth",
      access: "legacy-access",
      refresh: "legacy-refresh",
      expiresAt: Date.now() + 60_000,
      metadata: {
        accountId: "acct-legacy",
      },
      createdAt: Date.now() - 10_000,
      updatedAt: Date.now() - 10_000,
    });

    expect(parsed).toBeDefined();
    expect(parsed?.methodID).toBe("oauth-device");
    expect(parsed?.methodType).toBe("oauth");
    expect(parsed?.metadata).toEqual({
      accountId: "acct-legacy",
    });
  });
});

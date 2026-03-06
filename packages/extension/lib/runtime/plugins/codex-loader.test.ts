// @ts-expect-error bun:test types are not part of this package's TypeScript environment.
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  mock,
} from "bun:test";
import type { AuthContext } from "@/lib/runtime/plugin-manager";

const setAuthMock = mock(async () => undefined);
mock.module("@/lib/runtime/auth-store", () => ({
  setAuth: setAuthMock,
}));

const { codexAuthPlugin } = await import("@/lib/runtime/plugins/codex");

function createProvider(): AuthContext["provider"] {
  return {
    id: "openai",
    name: "OpenAI",
    source: "models.dev",
    env: ["OPENAI_API_KEY"],
    connected: true,
    options: {},
  };
}

function createAuthContext(provider = createProvider()): AuthContext {
  return {
    providerID: provider.id,
    provider,
  };
}

function makeJwt(claims: Record<string, unknown>) {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none", typ: "JWT" })}.${encode(claims)}.`;
}

function getLoader() {
  const loader = codexAuthPlugin.hooks.auth?.loader;
  if (!loader) {
    throw new Error("codex auth loader is unavailable");
  }
  return loader;
}

describe("codex loader account header consistency", () => {
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
    const loader = getLoader();

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

    const provider = createProvider();
    const output = await loader(
      {
        type: "oauth",
        access: "stale-access",
        refresh: "stale-refresh",
        expiresAt: Date.now() - 1_000,
        accountId: "acct-old",
        metadata: { authMode: "codex_oauth", accountId: "acct-old" },
        createdAt: Date.now() - 10_000,
        updatedAt: Date.now() - 10_000,
      },
      provider,
      createAuthContext(provider),
    );

    expect(output?.transport?.apiKey).toBe("refreshed-access");
    expect(output?.transport?.headers?.["chatgpt-account-id"]).toBe("acct-new");

    expect(setAuthMock).toHaveBeenCalledTimes(1);
    const [, payload] = setAuthMock.mock.calls[0];
    expect(payload.accountId).toBe("acct-new");
    expect(payload.metadata.accountId).toBe("acct-new");
  });

  it("keeps prior account id when refreshed token has no claim", async () => {
    const loader = getLoader();

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

    const provider = createProvider();
    const output = await loader(
      {
        type: "oauth",
        access: "stale-access",
        refresh: "stale-refresh",
        expiresAt: Date.now() - 1_000,
        accountId: "acct-existing",
        metadata: { authMode: "codex_oauth", accountId: "acct-existing" },
        createdAt: Date.now() - 10_000,
        updatedAt: Date.now() - 10_000,
      },
      provider,
      createAuthContext(provider),
    );

    expect(output?.transport?.headers?.["chatgpt-account-id"]).toBe(
      "acct-existing",
    );
    const [, payload] = setAuthMock.mock.calls[0];
    expect(payload.accountId).toBe("acct-existing");
    expect(payload.metadata.accountId).toBe("acct-existing");
  });

  it("omits header and warns when account id remains missing after refresh", async () => {
    const loader = getLoader();

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

    const provider = createProvider();
    const output = await loader(
      {
        type: "oauth",
        access: "stale-access",
        refresh: "stale-refresh",
        expiresAt: Date.now() - 1_000,
        metadata: { authMode: "codex_oauth" },
        createdAt: Date.now() - 10_000,
        updatedAt: Date.now() - 10_000,
      },
      provider,
      createAuthContext(provider),
    );

    expect(output?.transport?.headers?.["chatgpt-account-id"]).toBeUndefined();

    expect(setAuthMock).toHaveBeenCalledTimes(1);
    const [, payload] = setAuthMock.mock.calls[0];
    expect(payload.accountId).toBeUndefined();
    expect(payload.metadata.accountId).toBeUndefined();

    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledWith(
      "[builtin-codex-auth] oauth accountId is missing; Codex requests may fail until token claims include chatgpt_account_id.",
    );
  });

  it("keeps existing behavior when refresh is not needed", async () => {
    const loader = getLoader();

    const fetchMock = mock(async () => {
      throw new Error("fetch should not be called");
    });
    globalThis.fetch = fetchMock;

    const provider = createProvider();
    const output = await loader(
      {
        type: "oauth",
        access: "current-access",
        refresh: "refresh-token",
        expiresAt: Date.now() + 30 * 60_000,
        accountId: "acct-steady",
        metadata: { authMode: "codex_oauth", accountId: "acct-steady" },
        createdAt: Date.now() - 10_000,
        updatedAt: Date.now() - 10_000,
      },
      provider,
      createAuthContext(provider),
    );

    expect(output?.transport?.apiKey).toBe("current-access");
    expect(output?.transport?.headers?.["chatgpt-account-id"]).toBe(
      "acct-steady",
    );
    expect(fetchMock).toHaveBeenCalledTimes(0);
    expect(setAuthMock).toHaveBeenCalledTimes(0);
    expect(console.warn).toHaveBeenCalledTimes(0);
  });
});

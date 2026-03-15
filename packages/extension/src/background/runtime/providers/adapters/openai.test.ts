import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Effect from "effect/Effect";
import {
  createAuthStoreSpies,
  makeRuntimeAdapterContext,
} from "@/background/runtime/providers/adapters/adapter-test-utils";
import { resolveOpenAIExecutionState } from "@/background/runtime/providers/adapters/openai";

function makeJwt(claims: Record<string, unknown>) {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none", typ: "JWT" })}.${encode(claims)}.`;
}

const openAIContext = makeRuntimeAdapterContext({
  providerID: "openai",
  providerName: "OpenAI",
  providerEnv: ["OPENAI_API_KEY"],
  modelID: "gpt-4o-mini",
  modelName: "GPT-4o mini",
  modelURL: "https://api.openai.com/v1",
  modelNpm: "@ai-sdk/openai",
  capabilities: {
    temperature: true,
    reasoning: false,
    attachment: false,
    toolcall: true,
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
});

describe("resolveOpenAIExecutionState", () => {
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;

  afterAll(() => {
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
  });

  beforeEach(() => {
    console.warn = vi.fn(() => undefined);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
  });

  it("uses refreshed account id for header and persisted auth", async () => {
    const { authStore, setCalls } = createAuthStoreSpies();
    globalThis.fetch = vi.fn(
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

    const output = await Effect.runPromise(
      resolveOpenAIExecutionState({
        ...openAIContext,
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
        authStore,
      }),
    );

    expect(output.apiKey).toBe("refreshed-access");
    expect(new Headers(output.headers).get("chatgpt-account-id")).toBe(
      "acct-new",
    );
    expect(setCalls).toHaveLength(1);
    expect(setCalls[0]).toMatchObject({
      accountId: "acct-new",
      metadata: { accountId: "acct-new" },
    });
  });

  it("keeps prior account id when refreshed token has no claim", async () => {
    const { authStore, setCalls } = createAuthStoreSpies();
    globalThis.fetch = vi.fn(
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

    const output = await Effect.runPromise(
      resolveOpenAIExecutionState({
        ...openAIContext,
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
        authStore,
      }),
    );

    expect(new Headers(output.headers).get("chatgpt-account-id")).toBe(
      "acct-existing",
    );
    expect(setCalls[0]).toMatchObject({
      accountId: "acct-existing",
      metadata: { accountId: "acct-existing" },
    });
  });

  it("omits header and warns when account id remains missing after refresh", async () => {
    const { authStore, setCalls } = createAuthStoreSpies();
    globalThis.fetch = vi.fn(
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

    const output = await Effect.runPromise(
      resolveOpenAIExecutionState({
        ...openAIContext,
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
        authStore,
      }),
    );

    expect(new Headers(output.headers).get("chatgpt-account-id")).toBeNull();
    expect(setCalls).toHaveLength(1);
    expect(setCalls[0]).toMatchObject({
      accountId: undefined,
      metadata: undefined,
    });
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it("keeps existing behavior when refresh is not needed", async () => {
    const { authStore, setCalls } = createAuthStoreSpies();
    const fetchMock = vi.fn(async () => {
      throw new Error("fetch should not be called");
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const output = await Effect.runPromise(
      resolveOpenAIExecutionState({
        ...openAIContext,
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
        authStore,
      }),
    );

    expect(output.apiKey).toBe("current-access");
    expect(new Headers(output.headers).get("chatgpt-account-id")).toBe(
      "acct-steady",
    );
    expect(fetchMock).toHaveBeenCalledTimes(0);
    expect(setCalls).toHaveLength(0);
    expect(console.warn).toHaveBeenCalledTimes(0);
  });
});

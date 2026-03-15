import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import * as Effect from "effect/Effect";
import { gitlabAdapter } from "@/background/runtime/providers/adapters/gitlab";
import type { AdapterAuthorizeContext } from "@/background/runtime/providers/adapters/types";

function getAuthMethod(methodID: string) {
  return Effect.runPromise(
    gitlabAdapter.listAuthMethods({
      providerID: "gitlab",
      provider: {
        id: "gitlab",
        name: "GitLab",
        source: "models.dev",
        env: [],
        connected: true,
        options: {},
      },
    }),
  ).then((methods) => {
    const method = methods.find((item) => item.id === methodID);
    if (!method) {
      throw new Error(`Missing auth method: ${methodID}`);
    }
    return method;
  });
}

function createAuthorizeContext(
  values: Record<string, string | undefined>,
): AdapterAuthorizeContext<Record<string, string | undefined>> {
  return {
    providerID: "gitlab",
    provider: {
      id: "gitlab",
      name: "GitLab",
      source: "models.dev",
      env: [],
      connected: true,
      options: {},
    },
    values,
    oauth: {
      getRedirectURL: () => "https://extension.test/oauth",
      launchWebAuthFlow: (url: string) => {
        const state = new URL(url).searchParams.get("state") ?? "";
        return Effect.succeed(
          `https://extension.test/oauth?code=gitlab-code&state=${state}`,
        );
      },
      parseCallback: (url: string) => {
        const parsed = new URL(url);
        return {
          code: parsed.searchParams.get("code") ?? undefined,
          state: parsed.searchParams.get("state") ?? undefined,
          error: parsed.searchParams.get("error") ?? undefined,
          errorDescription:
            parsed.searchParams.get("error_description") ?? undefined,
        };
      },
    },
    authFlow: {
      publish: () => Effect.void,
    },
    runtime: {
      now: () => Date.now(),
    },
  };
}

describe("gitlabAdapter", () => {
  const originalFetch = globalThis.fetch;

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("lists oauth and pat auth methods", async () => {
    const methods = await Effect.runPromise(
      gitlabAdapter.listAuthMethods({
        providerID: "gitlab",
        provider: {
          id: "gitlab",
          name: "GitLab",
          source: "models.dev",
          env: [],
          connected: true,
          options: {},
        },
      }),
    );

    expect(methods.map((method) => method.id)).toEqual(["oauth", "pat"]);
  });

  it("authorizes GitLab OAuth through the adapter method surface", async () => {
    const oauthMethod = await getAuthMethod("oauth");
    globalThis.fetch = vi.fn(async (url: RequestInfo | URL) => {
      expect(String(url)).toBe("https://gitlab.example.com/oauth/token");
      return new Response(
        JSON.stringify({
          access_token: "oauth-access",
          refresh_token: "oauth-refresh",
          expires_in: 3600,
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    }) as unknown as typeof fetch;

    const result = await Effect.runPromise(
      oauthMethod.authorize(
        createAuthorizeContext({
          instanceUrl: "gitlab.example.com",
        }),
      ),
    );

    expect(result).toMatchObject({
      type: "oauth",
      methodID: "oauth",
      methodType: "oauth",
      access: "oauth-access",
      refresh: "oauth-refresh",
      metadata: {
        instanceUrl: "https://gitlab.example.com",
      },
    });
  });

  it("validates a GitLab personal access token through the adapter method surface", async () => {
    const patMethod = await getAuthMethod("pat");
    globalThis.fetch = vi.fn(async (url: RequestInfo | URL) => {
      expect(String(url)).toBe("https://gitlab.com/api/v4/user");
      return new Response(null, {
        status: 200,
      });
    }) as unknown as typeof fetch;

    const result = await Effect.runPromise(
      patMethod.authorize(
        createAuthorizeContext({
          token: "glpat-valid-token",
        }),
      ),
    );

    expect(result).toEqual({
      type: "api",
      key: "glpat-valid-token",
      methodID: "pat",
      methodType: "pat",
      metadata: {
        instanceUrl: "https://gitlab.com",
      },
    });
  });

  it("returns a typed auth failure when GitLab PAT validation fails", async () => {
    const patMethod = await getAuthMethod("pat");
    globalThis.fetch = vi.fn(
      async () =>
        new Response(null, {
          status: 401,
        }),
    ) as unknown as typeof fetch;

    const result = await Effect.runPromise(
      Effect.either(
        patMethod.authorize(
          createAuthorizeContext({
            token: "glpat-invalid-token",
          }),
        ),
      ),
    );

    expect(result).toMatchObject({
      _tag: "Left",
      left: {
        _tag: "RuntimeAuthProviderError",
        message: "GitLab personal access token validation failed.",
      },
    });
  });
});

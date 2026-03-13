import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import {
  RuntimeAuthProviderError,
  type RuntimeRpcError,
  RuntimeValidationError,
  type RuntimeAuthFlowInstruction,
} from "@llm-bridge/contracts";
import * as Effect from "effect/Effect";
import type {
  AIAdapter,
  AnyAuthMethodDefinition,
} from "@/background/runtime/providers/adapters/types";
import type { AuthRecord, AuthResult } from "@/background/runtime/auth/auth-store";

const provider = {
  id: "openai",
  name: "OpenAI",
  source: "models.dev" as const,
  env: ["OPENAI_API_KEY"],
  connected: true,
  options: {},
};

let storedAuth: AuthRecord | undefined;
let persistedAuth: Array<{ providerID: string; result: AuthResult }> = [];
let instructions: Array<RuntimeAuthFlowInstruction> = [];

let authorizeImpl: (
  input: Parameters<AnyAuthMethodDefinition["authorize"]>[0],
) => Effect.Effect<AuthResult, RuntimeRpcError> = () =>
  Effect.succeed({
    type: "api",
    key: "api-key-1",
    methodID: "apikey",
    methodType: "apikey",
  });

const adapter: AIAdapter = {
  key: "test-adapter",
  displayName: "Test Adapter",
  match: {
    providerIDs: ["openai"],
  },
  listAuthMethods: () =>
    Effect.succeed([
      {
        id: "oauth",
        type: "oauth",
        label: "OAuth",
        authorize: (input) => authorizeImpl(input),
      },
    ]),
  createModel: () => Effect.die("unused"),
};

mock.module("@/background/security/runtime-security", () => ({
  provideRuntimeSecurity: <A, E, R>(effect: Effect.Effect<A, E, R>) => effect,
}));

mock.module("@/background/runtime/catalog/models-dev", () => ({
  getModelsDevData: () =>
    Effect.succeed({
      openai: {
        name: "OpenAI",
        models: {},
      },
    }),
}));

mock.module("@/background/runtime/providers/adapters", () => ({
  resolveAdapterForProvider: () => adapter,
}));

mock.module("@/background/runtime/catalog/provider-registry", () => ({
  getProvider: () => Effect.succeed(provider),
}));

mock.module("@/background/runtime/auth/auth-store", () => ({
  getAuth: () => Effect.succeed(storedAuth),
  setAuth: (providerID: string, result: AuthResult) =>
    Effect.sync(() => {
      persistedAuth.push({ providerID, result });
      storedAuth = {
        ...result,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      } as AuthRecord;
    }),
  removeAuth: () => Effect.void,
}));

const { listProviderAuthMethods, startProviderAuth } =
  await import("./provider-auth");

beforeEach(() => {
  storedAuth = undefined;
  persistedAuth = [];
  instructions = [];
  authorizeImpl = () =>
    Effect.succeed({
      type: "api",
      key: "api-key-1",
      methodID: "apikey",
      methodType: "apikey",
    });
});

afterAll(() => {
  mock.restore();
});

describe("provider-auth", () => {
  it("lists runtime auth methods from an Effect-based adapter", async () => {
    const methods = await Effect.runPromise(listProviderAuthMethods("openai"));

    expect(methods).toEqual([
      {
        id: "oauth",
        type: "oauth",
        label: "OAuth",
        fields: [],
      },
    ]);
  });

  it("persists auth after successful authorization", async () => {
    const result = await Effect.runPromise(
      startProviderAuth({
        providerID: "openai",
        methodID: "oauth",
      }),
    );

    expect(result).toEqual({
      methodID: "oauth",
      connected: true,
    });
    expect(persistedAuth).toHaveLength(1);
    expect(persistedAuth[0]).toMatchObject({
      providerID: "openai",
      result: {
        type: "api",
        key: "api-key-1",
        methodID: "apikey",
        methodType: "apikey",
      },
    });
  });

  it("forwards auth instructions through the Effect callback", async () => {
    authorizeImpl = (input) =>
      input.authFlow.publish({
        kind: "notice",
        title: "Continue in browser",
        message: "Finish signing in.",
        url: "https://example.test/auth",
        autoOpened: true,
      }).pipe(
        Effect.zipRight(
          Effect.succeed({
            type: "api",
            key: "api-key-2",
            methodID: "apikey",
            methodType: "apikey",
          }),
        ),
      );

    await Effect.runPromise(
      startProviderAuth({
        providerID: "openai",
        methodID: "oauth",
        onInstruction: (instruction) =>
          Effect.sync(() => {
            instructions.push(instruction);
          }),
      }),
    );

    expect(instructions).toEqual([
      {
        kind: "notice",
        title: "Continue in browser",
        message: "Finish signing in.",
        url: "https://example.test/auth",
        autoOpened: true,
      },
    ]);
  });

  it("preserves typed adapter failures", async () => {
    authorizeImpl = () =>
      Effect.fail(
        new RuntimeValidationError({
          message: "Invalid provider input",
        }),
      );

    const result = await Effect.runPromise(
      Effect.either(
        startProviderAuth({
          providerID: "openai",
          methodID: "oauth",
        }),
      ),
    );

    expect(result).toMatchObject({
      _tag: "Left",
      left: {
        _tag: "RuntimeValidationError",
        message: "Invalid provider input",
      },
    });
  });

  it("wraps adapter defects as runtime auth plugin failures", async () => {
    authorizeImpl = () => Effect.die(new Error("plugin exploded"));

    const result = await Effect.runPromise(
      Effect.either(
        startProviderAuth({
          providerID: "openai",
          methodID: "oauth",
        }),
      ),
    );

    expect(result).toMatchObject({
      _tag: "Left",
      left: {
        _tag: "RuntimeAuthProviderError",
        operation: "auth.authorize",
        message: "plugin exploded",
      } satisfies Partial<RuntimeAuthProviderError>,
    });
  });
});

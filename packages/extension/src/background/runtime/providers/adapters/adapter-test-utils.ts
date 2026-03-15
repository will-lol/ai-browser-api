import * as Effect from "effect/Effect";
import type {
  AuthRecord,
  AuthResult,
} from "@/background/runtime/auth/auth-store";
import type { RuntimeAdapterContext } from "./types";

type ModelCapabilities = RuntimeAdapterContext["model"]["capabilities"];

type MakeRuntimeAdapterContextInput = {
  providerID: string;
  providerName: string;
  providerEnv: Array<string>;
  modelID: string;
  modelName: string;
  modelURL: string;
  modelNpm: string;
  capabilities: ModelCapabilities;
  origin?: string;
  sessionID?: string;
  requestID?: string;
  providerOptions?: Record<string, unknown>;
  modelOptions?: Record<string, unknown>;
  modelHeaders?: Record<string, string>;
  now?: () => number;
};

export function makeRuntimeAdapterContext(
  input: MakeRuntimeAdapterContextInput,
): Omit<RuntimeAdapterContext, "auth" | "authStore"> {
  return {
    providerID: input.providerID,
    modelID: input.modelID,
    origin: input.origin ?? "https://example.test",
    sessionID: input.sessionID ?? "session-1",
    requestID: input.requestID ?? "request-1",
    provider: {
      id: input.providerID,
      name: input.providerName,
      source: "models.dev",
      env: input.providerEnv,
      connected: true,
      options: input.providerOptions ?? {},
    },
    model: {
      id: input.modelID,
      providerID: input.providerID,
      name: input.modelName,
      status: "active",
      api: {
        id: input.modelID,
        url: input.modelURL,
        npm: input.modelNpm,
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
      options: input.modelOptions ?? {},
      headers: input.modelHeaders ?? {},
      capabilities: input.capabilities,
    },
    runtime: {
      now: input.now ?? (() => Date.now()),
    },
  };
}

export function createAuthStoreSpies(initialAuth?: AuthRecord) {
  const setCalls: Array<AuthResult> = [];
  let removeCalls = 0;

  return {
    authStore: {
      get: () => Effect.succeed(initialAuth),
      set: (auth: AuthResult) =>
        Effect.sync(() => {
          setCalls.push(auth);
        }),
      remove: () =>
        Effect.sync(() => {
          removeCalls += 1;
        }),
    },
    setCalls,
    getRemoveCalls: () => removeCalls,
  };
}

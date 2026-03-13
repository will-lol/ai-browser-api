import type { LanguageModelV3 } from "@ai-sdk/provider";
import type {
  RuntimeAuthFlowInstruction,
  RuntimeRpcError,
  RuntimeResolvedAuthMethod,
} from "@llm-bridge/contracts";
import type * as Effect from "effect/Effect";
import type * as Schema from "effect/Schema";
import type {
  AuthMethodType,
  AuthRecord,
  AuthResult,
} from "@/background/runtime/auth/auth-store";
import type {
  ProviderInfo,
  ProviderModelInfo,
  ProviderRuntimeInfo,
} from "@/background/runtime/catalog/provider-registry";

export type { AuthMethodType } from "@/background/runtime/auth/auth-store";

export interface AdapterAuthContext {
  providerID: string;
  provider: ProviderRuntimeInfo;
  auth?: AuthRecord;
}

export interface AdapterAuthorizeContext<
  TValues extends Record<string, string | undefined> = Record<
    string,
    string | undefined
  >,
> extends AdapterAuthContext {
  values: TValues;
  signal?: AbortSignal;
  oauth: {
    getRedirectURL: (path?: string) => string;
    launchWebAuthFlow: (url: string) => Effect.Effect<string, RuntimeRpcError>;
    parseCallback: (url: string) => {
      code?: string;
      state?: string;
      error?: string;
      errorDescription?: string;
    };
  };
  authFlow: {
    publish: (
      instruction: RuntimeAuthFlowInstruction,
    ) => Effect.Effect<void, RuntimeRpcError>;
  };
  runtime: {
    now: () => number;
  };
}

export interface RuntimeAdapterContext extends AdapterAuthContext {
  modelID: string;
  model: ProviderModelInfo;
  origin: string;
  sessionID: string;
  requestID: string;
  authStore: {
    get: () => Effect.Effect<AuthRecord | undefined, RuntimeRpcError>;
    set: (auth: AuthResult) => Effect.Effect<void, RuntimeRpcError>;
    remove: () => Effect.Effect<void, RuntimeRpcError>;
  };
  runtime: {
    now: () => number;
  };
}

export type RuntimeFetch = typeof globalThis.fetch;

export interface AuthMethodDefinition<
  TValues extends Record<string, string | undefined> = Record<
    string,
    string | undefined
  >,
> {
  id: string;
  type: AuthMethodType;
  label: string;
  inputSchema?: Schema.Schema.AnyNoContext;
  authorize: (
    ctx: AdapterAuthorizeContext<TValues>,
  ) => Effect.Effect<AuthResult, RuntimeRpcError>;
}

export type AnyAuthMethodDefinition = AuthMethodDefinition<
  Record<string, string | undefined>
>;

export type RuntimeAuthMethod = RuntimeResolvedAuthMethod;

export interface AIAdapter {
  key: string;
  displayName: string;
  match: {
    npm?: string;
    providerIDs?: readonly string[];
  };
  listAuthMethods: (
    ctx: AdapterAuthContext,
  ) => Effect.Effect<AnyAuthMethodDefinition[], RuntimeRpcError>;
  createModel: (
    context: RuntimeAdapterContext,
  ) => Effect.Effect<LanguageModelV3, RuntimeRpcError>;
  patchCatalog?: (
    ctx: AdapterAuthContext,
    provider: ProviderInfo,
  ) => Effect.Effect<ProviderInfo | void, RuntimeRpcError>;
}

export type RegisteredAdapter = AIAdapter;

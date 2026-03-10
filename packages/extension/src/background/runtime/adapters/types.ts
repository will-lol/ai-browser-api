import type { LanguageModelV3 } from "@ai-sdk/provider";
import type { RuntimeAuthFlowInstruction } from "@llm-bridge/contracts";
import type * as Schema from "effect/Schema";
import type {
  AuthMethodType,
  AuthRecord,
  AuthResult,
} from "@/background/runtime/auth-store";
import type {
  ProviderInfo,
  ProviderModelInfo,
  ProviderRuntimeInfo,
} from "@/background/runtime/provider-registry";

type AuthFieldCondition = {
  key: string;
  equals: string;
};

type AuthFieldValidation = {
  regex?: string;
  message?: string;
  minLength?: number;
  maxLength?: number;
};

type AuthFieldBase = {
  key: string;
  label: string;
  placeholder?: string;
  defaultValue?: string;
  required?: boolean;
  description?: string;
  condition?: AuthFieldCondition;
  validate?: AuthFieldValidation;
};

type AuthFieldOption = {
  label: string;
  value: string;
  hint?: string;
};

export type AuthField =
  | ({
      type: "text" | "secret";
    } & AuthFieldBase)
  | ({
      type: "select";
      options: AuthFieldOption[];
    } & AuthFieldBase);

export type { AuthMethodType } from "@/background/runtime/auth-store";

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
    launchWebAuthFlow: (url: string) => Promise<string>;
    parseCallback: (url: string) => {
      code?: string;
      state?: string;
      error?: string;
      errorDescription?: string;
    };
  };
  authFlow: {
    publish: (instruction: RuntimeAuthFlowInstruction) => Promise<void>;
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
    get: () => Promise<AuthRecord | undefined>;
    set: (auth: AuthResult) => Promise<void>;
    remove: () => Promise<void>;
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
  authorize: (ctx: AdapterAuthorizeContext<TValues>) => Promise<AuthResult>;
}

export type AnyAuthMethodDefinition = AuthMethodDefinition<
  Record<string, string | undefined>
>;

export type RuntimeAuthMethod = {
  id: string;
  type: AuthMethodType;
  label: string;
};

export interface ResolvedAuthMethod {
  adapter: RegisteredAdapter;
  definition: AnyAuthMethodDefinition;
  method: RuntimeAuthMethod;
}

export interface AIAdapter {
  key: string;
  displayName: string;
  match: {
    npm?: string;
    providerIDs?: readonly string[];
  };
  listAuthMethods: (
    ctx: AdapterAuthContext,
  ) => Promise<AnyAuthMethodDefinition[]> | AnyAuthMethodDefinition[];
  createModel: (context: RuntimeAdapterContext) => Promise<LanguageModelV3>;
  patchCatalog?: (
    ctx: AdapterAuthContext,
    provider: ProviderInfo,
  ) => Promise<ProviderInfo | void> | ProviderInfo | void;
}

export type RegisteredAdapter = AIAdapter;

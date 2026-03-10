import type { LanguageModelV3 } from "@ai-sdk/provider";
import type { RuntimeAuthFlowInstruction } from "@llm-bridge/contracts";
import type { z } from "zod";
import type {
  AuthMethodType,
  AuthRecord,
  AuthResult,
  JsonObject,
} from "@/lib/runtime/auth-store";
import type {
  ProviderInfo,
  ProviderModelInfo,
  ProviderRuntimeInfo,
} from "@/lib/runtime/provider-registry";

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

export type { AuthMethodType } from "@/lib/runtime/auth-store";

export type ParsedAuthRecord<
  TMetadata extends JsonObject | undefined = JsonObject | undefined,
> =
  | (Extract<AuthRecord<TMetadata>, { type: "api" }> & {
      methodID: string;
      methodType: AuthMethodType;
    })
  | (Extract<AuthRecord<TMetadata>, { type: "oauth" }> & {
      methodID: string;
      methodType: AuthMethodType;
    });

export interface AdapterAuthContext<
  TMetadata extends JsonObject | undefined = JsonObject | undefined,
> {
  providerID: string;
  provider: ProviderRuntimeInfo;
  auth?: ParsedAuthRecord<TMetadata>;
}

export interface AdapterAuthorizeContext<
  TValues extends Record<string, string> = Record<string, string>,
  TMetadata extends JsonObject | undefined = JsonObject | undefined,
> extends AdapterAuthContext<TMetadata> {
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

export interface RuntimeAdapterContext<
  TMetadata extends JsonObject | undefined = JsonObject | undefined,
> extends AdapterAuthContext<TMetadata> {
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
  TValues extends Record<string, string> = Record<string, string>,
  TMetadata extends JsonObject | undefined = JsonObject | undefined,
> {
  id: string;
  type: AuthMethodType;
  label: string;
  inputSchema?: z.ZodType<TValues>;
  authorize: (
    ctx: AdapterAuthorizeContext<TValues, TMetadata>,
  ) => Promise<AuthResult<TMetadata>>;
}

export type AnyAuthMethodDefinition = AuthMethodDefinition<
  Record<string, string>,
  JsonObject | undefined
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

export interface AIAdapter<
  TPersistedAuthMeta extends JsonObject | undefined = JsonObject | undefined,
> {
  key: string;
  displayName: string;
  match: {
    npm?: string;
    providerIDs?: readonly string[];
  };
  auth: {
    methods: (
      ctx: AdapterAuthContext<TPersistedAuthMeta>,
    ) =>
      | Promise<AnyAuthMethodDefinition[]>
      | AnyAuthMethodDefinition[];
    parseStoredAuth: (
      auth?: AuthRecord,
    ) => ParsedAuthRecord<TPersistedAuthMeta> | undefined;
    serializeAuth: (input: {
      result: AuthResult<TPersistedAuthMeta>;
      method: Pick<AnyAuthMethodDefinition, "id" | "type">;
    }) => AuthResult<TPersistedAuthMeta>;
  };
  createModel: (
    context: RuntimeAdapterContext<TPersistedAuthMeta>,
  ) => Promise<LanguageModelV3>;
  patchCatalog?: (
    ctx: AdapterAuthContext<TPersistedAuthMeta>,
    provider: ProviderInfo,
  ) => Promise<ProviderInfo | void> | ProviderInfo | void;
}

export type RegisteredAdapter = {
  readonly key: string;
  readonly displayName: string;
  readonly match: {
    readonly npm?: string;
    readonly providerIDs?: readonly string[];
  };
  readonly auth: {
    methods: (
      ctx: AdapterAuthContext,
    ) => Promise<AnyAuthMethodDefinition[]> | AnyAuthMethodDefinition[];
    parseStoredAuth: (auth?: AuthRecord) => ParsedAuthRecord | undefined;
    serializeAuth: (input: {
      result: AuthResult;
      method: Pick<AnyAuthMethodDefinition, "id" | "type">;
    }) => AuthResult;
  };
  readonly createModel: (
    context: RuntimeAdapterContext,
  ) => Promise<LanguageModelV3>;
  readonly patchCatalog?: (
    ctx: AdapterAuthContext,
    provider: ProviderInfo,
  ) => Promise<ProviderInfo | void> | ProviderInfo | void;
};

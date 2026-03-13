import type {
  RuntimeAuthMethod,
  RuntimeGenerateResponse,
  RuntimeRpcError,
  RuntimeStreamPart,
} from "@llm-bridge/contracts";
import type * as Effect from "effect/Effect";
import type * as Stream from "effect/Stream";

export interface ProviderAdapterAuthorizeInput {
  providerID: string;
  methodID: string;
  values?: Record<string, string>;
  signal?: AbortSignal;
}

export interface ProviderAdapterAuthResult {
  connected: boolean;
  methodID: string;
}

export interface ProviderAdapterCatalog {
  providerID: string;
  providerName: string;
  models: ReadonlyArray<{
    id: string;
    name: string;
    capabilities: ReadonlyArray<string>;
  }>;
}

export interface ProviderModelExecutor {
  doGenerate: (
    options: Record<string, unknown>,
  ) => Effect.Effect<RuntimeGenerateResponse>;
  doStream: (
    options: Record<string, unknown>,
  ) => Effect.Effect<
    Stream.Stream<RuntimeStreamPart, RuntimeRpcError>,
    RuntimeRpcError
  >;
}

export interface ProviderAdapterHooks {
  patchHeaders?: (
    headers: Record<string, string>,
  ) => Effect.Effect<Record<string, string>>;
  patchProviderOptions?: (
    options: Record<string, unknown>,
  ) => Effect.Effect<Record<string, unknown>>;
  onEvent?: (
    name: string,
    payload: Record<string, unknown>,
  ) => Effect.Effect<void>;
}

export interface ProviderAdapter {
  readonly id: string;
  resolveCatalog: () => Effect.Effect<ProviderAdapterCatalog>;
  listAuthMethods: () => Effect.Effect<ReadonlyArray<RuntimeAuthMethod>>;
  authorize: (
    input: ProviderAdapterAuthorizeInput,
  ) => Effect.Effect<ProviderAdapterAuthResult>;
  disconnect: () => Effect.Effect<void>;
  buildModelExecutor: (modelID: string) => Effect.Effect<ProviderModelExecutor>;
  prepareRequest: (input: {
    modelID: string;
    options: Record<string, unknown>;
  }) => Effect.Effect<Record<string, unknown>>;
  parseResponse: (input: {
    modelID: string;
    response: unknown;
  }) => Effect.Effect<RuntimeGenerateResponse>;
  hooks?: ProviderAdapterHooks;
}

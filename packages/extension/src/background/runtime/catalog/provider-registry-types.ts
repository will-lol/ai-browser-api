export interface ModelCapabilities {
  temperature: boolean;
  reasoning: boolean;
  attachment: boolean;
  toolcall: boolean;
  input: {
    text: boolean;
    audio: boolean;
    image: boolean;
    video: boolean;
    pdf: boolean;
  };
  output: {
    text: boolean;
    audio: boolean;
    image: boolean;
    video: boolean;
    pdf: boolean;
  };
}

export interface ProviderModelInfo {
  id: string;
  providerID: string;
  name: string;
  family?: string;
  status: "alpha" | "beta" | "deprecated" | "active";
  release_date?: string;
  api: {
    id: string;
    url: string;
    npm: string;
  };
  cost: {
    input: number;
    output: number;
    cache: {
      read: number;
      write: number;
    };
  };
  limit: {
    context: number;
    input?: number;
    output: number;
  };
  options: Record<string, unknown>;
  headers: Record<string, string>;
  capabilities: ModelCapabilities;
  variants?: Record<string, Record<string, unknown>>;
}

export interface ProviderRuntimeInfo<
  TOptions extends Record<string, unknown> = Record<string, unknown>,
> {
  id: string;
  name: string;
  source: "models.dev" | "config";
  env: string[];
  connected: boolean;
  options: TOptions;
}

export interface ProviderInfo<
  TOptions extends Record<string, unknown> = Record<string, unknown>,
> extends ProviderRuntimeInfo<TOptions> {
  models: Record<string, ProviderModelInfo>;
}

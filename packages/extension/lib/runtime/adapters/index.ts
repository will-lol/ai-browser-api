import type { AuthRecord, AuthResult } from "@/lib/runtime/auth-store";
import type { ModelsDevProvider } from "@/lib/runtime/models-dev";
import type { ProviderModelInfo } from "@/lib/runtime/provider-registry";
import { genericFactoryAdapters } from "./generic-factory";
import { normalizeFactoryNpm } from "./factory-language-model";
import { githubCopilotAdapter } from "./github-copilot";
import { gitlabAdapter } from "./gitlab";
import { googleAdapter } from "./google";
import { openaiAdapter } from "./openai";
import type {
  AIAdapter,
  AdapterAuthContext,
  AnyAuthMethodDefinition,
  ParsedAuthRecord,
  RegisteredAdapter,
  RuntimeAdapterContext,
} from "./types";

function registerAdapter<
  TPersistedAuthMeta extends ParsedAuthRecord["metadata"],
>(
  adapter: AIAdapter<TPersistedAuthMeta>,
): RegisteredAdapter {
  return {
    key: adapter.key,
    displayName: adapter.displayName,
    match: adapter.match,
    auth: {
      methods: (ctx) =>
        adapter.auth.methods(ctx as AdapterAuthContext<TPersistedAuthMeta>),
      parseStoredAuth: (auth) => adapter.auth.parseStoredAuth(auth),
      serializeAuth: (input) =>
        adapter.auth.serializeAuth({
          result: input.result as AuthResult<TPersistedAuthMeta>,
          method: input.method,
        }),
    },
    createModel: (context) =>
      adapter.createModel(
        context as RuntimeAdapterContext<TPersistedAuthMeta>,
      ),
    patchCatalog: adapter.patchCatalog
      ? (ctx, provider) =>
          adapter.patchCatalog?.(
            ctx as AdapterAuthContext<TPersistedAuthMeta>,
            provider,
          )
      : undefined,
  };
}

const allAdapters: RegisteredAdapter[] = [
  ...Object.values(genericFactoryAdapters).map((adapter) =>
    registerAdapter(adapter),
  ),
  registerAdapter(openaiAdapter),
  registerAdapter(googleAdapter),
  registerAdapter(githubCopilotAdapter),
  registerAdapter(gitlabAdapter),
];

const providerAdapters = new Map<string, RegisteredAdapter>();
const npmAdapters = new Map<string, RegisteredAdapter>();

for (const adapter of allAdapters) {
  for (const providerID of adapter.match.providerIDs ?? []) {
    providerAdapters.set(providerID, adapter);
  }

  if (adapter.match.npm) {
    npmAdapters.set(adapter.match.npm, adapter);
  }
}

function normalizeLookupNpm(npm?: string) {
  if (!npm) return undefined;
  try {
    return normalizeFactoryNpm(npm);
  } catch {
    if (npmAdapters.has(npm)) return npm;
    return undefined;
  }
}

function firstModelNpm(source?: ModelsDevProvider) {
  if (!source) return undefined;
  for (const model of Object.values(source.models)) {
    const modelNpm = model.provider?.npm ?? source.npm;
    if (typeof modelNpm === "string" && modelNpm.length > 0) {
      return modelNpm;
    }
  }
  return undefined;
}

export function resolveAdapterForProvider(input: {
  providerID: string;
  source?: ModelsDevProvider;
}): RegisteredAdapter | undefined {
  const providerAdapter = providerAdapters.get(input.providerID);
  if (providerAdapter) return providerAdapter;

  const normalizedNpm = normalizeLookupNpm(
    input.source?.npm ?? firstModelNpm(input.source),
  );
  if (!normalizedNpm) return undefined;
  return npmAdapters.get(normalizedNpm);
}

export function resolveAdapterForModel(input: {
  providerID: string;
  model: ProviderModelInfo;
}): RegisteredAdapter | undefined {
  const providerAdapter = providerAdapters.get(input.providerID);
  if (providerAdapter) return providerAdapter;

  const normalizedNpm = normalizeLookupNpm(input.model.api.npm);
  if (!normalizedNpm) return undefined;
  return npmAdapters.get(normalizedNpm);
}

export function parseAdapterStoredAuth(
  adapter: RegisteredAdapter,
  auth?: AuthRecord,
): ParsedAuthRecord | undefined {
  return adapter.auth.parseStoredAuth(auth);
}

export function serializeAdapterAuthResult(input: {
  adapter: RegisteredAdapter;
  method: Pick<AnyAuthMethodDefinition, "id" | "type">;
  result: AuthResult;
}): AuthResult {
  return input.adapter.auth.serializeAuth({
    method: input.method,
    result: input.result,
  });
}

import snapshotData from "@/lib/runtime/models-snapshot.json";
import { resolveAdapterForProvider } from "@/lib/runtime/adapters";
import { getAuthSchemaFields } from "@/lib/runtime/adapters/schema";
import type {
  AnyAuthMethodDefinition,
  AuthField,
} from "@/lib/runtime/adapters/types";
import type { ModelsDevProvider } from "@/lib/runtime/models-dev";
import type {
  ExtensionAuthMethod,
  ExtensionProvider,
} from "@/lib/extension-runtime-api";
export type ExtensionResolvedAuthMethod = Pick<
  AnyAuthMethodDefinition,
  "id" | "type" | "label" | "inputSchema"
> & {
  fields: ReadonlyArray<AuthField>;
};

function normalizeModelsDevProvider(
  providerID: string,
): ModelsDevProvider | undefined {
  const rawProvider = snapshotData[providerID as keyof typeof snapshotData];
  if (!rawProvider || typeof rawProvider !== "object") {
    return undefined;
  }

  const env = Array.isArray(rawProvider.env)
    ? rawProvider.env.filter(
        (item): item is string => typeof item === "string",
      )
    : [];

  return {
    id:
      typeof rawProvider.id === "string" && rawProvider.id.length > 0
        ? rawProvider.id
        : providerID,
    name:
      typeof rawProvider.name === "string" && rawProvider.name.length > 0
        ? rawProvider.name
        : providerID,
    env,
    api:
      "api" in rawProvider && typeof rawProvider.api === "string"
        ? rawProvider.api
        : undefined,
    npm: typeof rawProvider.npm === "string" ? rawProvider.npm : undefined,
    models:
      rawProvider.models && typeof rawProvider.models === "object"
        ? (rawProvider.models as ModelsDevProvider["models"])
        : {},
  };
}

function toProviderRuntimeInfo(
  providerID: string,
  provider?: ExtensionProvider,
  source?: ModelsDevProvider,
) {
  return {
    id: providerID,
    name: provider?.name ?? source?.name ?? providerID,
    source: "models.dev" as const,
    env: [...(provider?.env ?? source?.env ?? [])],
    connected: provider?.connected ?? false,
    options: {},
  };
}

function toExtensionResolvedAuthMethod(
  definition: AnyAuthMethodDefinition,
): ExtensionResolvedAuthMethod {
  return {
    id: definition.id.trim(),
    type: definition.type,
    label: definition.label.trim() || definition.id.trim(),
    inputSchema: definition.inputSchema,
    fields: getAuthSchemaFields(definition.inputSchema),
  };
}

export async function resolveExtensionAuthMethods(input: {
  providerID: string;
  provider?: ExtensionProvider;
  methodIDs?: ReadonlyArray<ExtensionAuthMethod["id"]>;
}) {
  const source = normalizeModelsDevProvider(input.providerID);
  const adapter = resolveAdapterForProvider({
    providerID: input.providerID,
    source,
  });
  if (!adapter) return [];

  const definitions = await adapter.auth.methods({
    providerID: input.providerID,
    provider: toProviderRuntimeInfo(input.providerID, input.provider, source),
  });
  const resolved = definitions.map(toExtensionResolvedAuthMethod);

  if (!input.methodIDs || input.methodIDs.length === 0) {
    return resolved;
  }

  const byID = new Map(resolved.map((method) => [method.id, method]));
  return input.methodIDs
    .map((methodID) => byID.get(methodID))
    .filter((method): method is ExtensionResolvedAuthMethod => Boolean(method));
}

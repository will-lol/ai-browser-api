import { resolveAdapterForProvider } from "@/background/runtime/adapters";
import { modelsDevData } from "@/background/runtime/models-dev";
import type {
  AnyAuthMethodDefinition,
} from "@/background/runtime/adapters/types";
import type { ModelsDevProvider } from "@/background/runtime/models-dev";
import {
  getAuthSchemaFields,
  type AuthField,
} from "@/shared/api/auth-schema";
import type {
  ExtensionAuthMethod,
  ExtensionProvider,
} from "@/shared/api/runtime-admin-api";
export type ExtensionResolvedAuthMethod = Pick<
  AnyAuthMethodDefinition,
  "id" | "type" | "label" | "inputSchema"
> & {
  fields: ReadonlyArray<AuthField>;
};

function getModelsDevProvider(
  providerID: string,
): ModelsDevProvider | undefined {
  if (!(providerID in modelsDevData)) return undefined;
  return modelsDevData[providerID];
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
  const source = getModelsDevProvider(input.providerID);
  const adapter = resolveAdapterForProvider({
    providerID: input.providerID,
    source,
  });
  if (!adapter) return [];

  const definitions = await adapter.listAuthMethods({
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

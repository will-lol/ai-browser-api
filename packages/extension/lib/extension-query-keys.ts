export const extensionQueryKeys = {
  providersRoot: ["providers"] as const,
  providers: () => extensionQueryKeys.providersRoot,

  modelsRoot: ["models"] as const,
  models: (input: {
    connectedOnly?: boolean
    providerID?: string
    origin?: string
  } = {}) =>
    [
      ...extensionQueryKeys.modelsRoot,
      input.connectedOnly === true,
      input.providerID ?? "*",
      input.origin ?? "*",
    ] as const,

  originStateRoot: ["originState"] as const,
  originState: (origin: string) =>
    [...extensionQueryKeys.originStateRoot, origin] as const,

  permissionsRoot: ["permissions"] as const,
  permissions: (origin: string) =>
    [...extensionQueryKeys.permissionsRoot, origin] as const,

  pendingRequestsRoot: ["pendingRequests"] as const,
  pendingRequests: (origin: string) =>
    [...extensionQueryKeys.pendingRequestsRoot, origin] as const,

  authMethodsRoot: ["authMethods"] as const,
  authMethods: (providerID: string) =>
    [...extensionQueryKeys.authMethodsRoot, providerID] as const,
}

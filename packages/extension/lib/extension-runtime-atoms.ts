import { Atom, Result } from "@effect-atom/atom-react";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import {
  currentOrigin,
  fetchModels,
  fetchOriginState,
  fetchPendingRequests,
  fetchPermissions,
  fetchProviderAuthFlow,
  fetchProviders,
} from "@/lib/extension-runtime-api";
import { extensionAtomRuntime } from "@/lib/extension-atom-runtime";
import { runtimeReactivityKeys } from "@/lib/extension-runtime-reactivity";

class ModelsKey extends Data.Class<{
  connectedOnly?: boolean;
  providerID?: string;
}> {}

const modelsResultAtomFamily = Atom.family((key: ModelsKey) =>
  extensionAtomRuntime
    .atom(
      fetchModels({
        connectedOnly: key.connectedOnly,
        providerID: key.providerID,
      }),
    )
    .pipe(Atom.withReactivity([runtimeReactivityKeys.models])),
);

export const providersResultAtom = extensionAtomRuntime
  .atom(fetchProviders())
  .pipe(Atom.withReactivity([runtimeReactivityKeys.providers]));

export const providerAuthFlowResultAtom = Atom.family((providerID: string) =>
  extensionAtomRuntime
    .atom(
      fetchProviderAuthFlow({
        providerID,
      }).pipe(Effect.map((response) => response.result)),
    )
    .pipe(Atom.withReactivity([runtimeReactivityKeys.authFlow(providerID)])),
);

export const originStateResultAtom = Atom.family((origin: string) =>
  extensionAtomRuntime
    .atom(fetchOriginState(origin))
    .pipe(Atom.withReactivity([runtimeReactivityKeys.origin(origin)])),
);

export const permissionsResultAtom = Atom.family((origin: string) =>
  extensionAtomRuntime
    .atom(fetchPermissions(origin))
    .pipe(Atom.withReactivity([runtimeReactivityKeys.permissions(origin)])),
);

export const pendingRequestsResultAtom = Atom.family((origin: string) =>
  extensionAtomRuntime
    .atom(fetchPendingRequests(origin))
    .pipe(Atom.withReactivity([runtimeReactivityKeys.pending(origin)])),
);

export function modelsResultAtom(input?: {
  connectedOnly?: boolean;
  providerID?: string;
}) {
  return modelsResultAtomFamily(
    new ModelsKey({
      connectedOnly: input?.connectedOnly,
      providerID: input?.providerID,
    }),
  );
}

export const currentOriginAtom = Atom.make(currentOrigin).pipe(Atom.keepAlive);

export const providerConnectDataResultAtom = Atom.family((providerID: string) =>
  Atom.make((get) =>
    Result.all({
      providers: get(providersResultAtom),
      authFlow: get(providerAuthFlowResultAtom(providerID)),
    }),
  ),
);

export const floatingPermissionDataResultAtom = Atom.family((origin: string) =>
  Atom.make((get) =>
    Result.all({
      originState: get(originStateResultAtom(origin)),
      pendingRequests: get(pendingRequestsResultAtom(origin)),
    }),
  ),
);

export const sitePermissionsDataResultAtom = Atom.family((origin: string) =>
  Atom.make((get) =>
    Result.all({
      originState: get(originStateResultAtom(origin)),
      models: get(
        modelsResultAtom({
          connectedOnly: true,
        }),
      ),
      permissions: get(permissionsResultAtom(origin)),
      pendingRequests: get(pendingRequestsResultAtom(origin)),
    }),
  ),
);

import { Atom, Result } from "@effect-atom/atom-react";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import {
  fetchModels,
  fetchOriginState,
  fetchPendingRequests,
  fetchPermissions,
  fetchProviderAuthFlow,
  fetchProviders,
} from "@/shared/api/runtime-admin-api";
import { extensionAtomRuntime } from "@/shared/state/atom-runtime";
import { runtimeReactivityKeys } from "@/shared/state/runtime-reactivity";

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

const providerAuthFlowResultAtom = Atom.family((providerID: string) =>
  extensionAtomRuntime
    .atom(
      fetchProviderAuthFlow({
        providerID,
      }).pipe(Effect.map((response) => response.result)),
    )
    .pipe(Atom.withReactivity([runtimeReactivityKeys.authFlow(providerID)])),
);

const originStateResultAtom = Atom.family((origin: string) =>
  extensionAtomRuntime
    .atom(fetchOriginState(origin))
    .pipe(Atom.withReactivity([runtimeReactivityKeys.origin(origin)])),
);

const permissionsResultAtom = Atom.family((origin: string) =>
  extensionAtomRuntime
    .atom(fetchPermissions(origin))
    .pipe(Atom.withReactivity([runtimeReactivityKeys.permissions(origin)])),
);

const pendingRequestsResultAtom = Atom.family((origin: string) =>
  extensionAtomRuntime
    .atom(fetchPendingRequests(origin))
    .pipe(Atom.withReactivity([runtimeReactivityKeys.pending(origin)])),
);

function modelsResultAtom(input?: {
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

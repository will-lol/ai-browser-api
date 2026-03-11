import {
  Atom,
  Registry,
  RegistryProvider,
  useAtomMount,
} from "@effect-atom/atom-react";
import * as Reactivity from "@effect/experimental/Reactivity";
import * as Effect from "effect/Effect";
import type * as Layer from "effect/Layer";
import * as Runtime from "effect/Runtime";
import type { ReactNode } from "react";

export type ReactiveRuntime<Services, RuntimeError> = {
  readonly atomRuntime: Atom.AtomRuntime<Services, RuntimeError>;
};

export type KeepAliveResource = {
  readonly atom: Atom.Atom<unknown>;
};

function KeepAliveMount({ resource }: { resource: KeepAliveResource }) {
  useAtomMount(resource.atom);
  return null;
}

export function createReactiveRuntime<Services, RuntimeError>(
  layer:
    | Layer.Layer<
        Services,
        RuntimeError,
        Reactivity.Reactivity | Registry.AtomRegistry
      >
    | ((
        get: Atom.Context,
      ) => Layer.Layer<
        Services,
        RuntimeError,
        Reactivity.Reactivity | Registry.AtomRegistry
      >),
): ReactiveRuntime<Services, RuntimeError> {
  return {
    atomRuntime: Atom.runtime(layer),
  };
}

export function ReactiveRuntimeProvider({
  children,
  keepAliveResources = [],
}: {
  children: ReactNode;
  keepAliveResources?: ReadonlyArray<KeepAliveResource>;
}) {
  return (
    <RegistryProvider>
      {keepAliveResources.map((resource, index) => (
        <KeepAliveMount key={index} resource={resource} />
      ))}
      {children}
    </RegistryProvider>
  );
}

export function createReactivityBridgeResource<
  Services,
  RuntimeError,
  Event,
>(
  runtime: ReactiveRuntime<Services, RuntimeError>,
  options: {
    subscribe: (handler: (event: Event) => void) => () => void;
    keysForEvent: (event: Event) => ReadonlyArray<string>;
  },
): KeepAliveResource {
  return {
    atom: runtime.atomRuntime
      .atom(
        Effect.gen(function* () {
          const reactiveRuntime = yield* Effect.runtime<Reactivity.Reactivity>();
          const runFork = Runtime.runFork(reactiveRuntime);
          const unsubscribe = options.subscribe((event) => {
            const keys = options.keysForEvent(event);
            if (keys.length === 0) return;
            runFork(Reactivity.invalidate(keys));
          });

          yield* Effect.addFinalizer(() => Effect.sync(unsubscribe));
        }),
      )
      .pipe(Atom.keepAlive),
  };
}

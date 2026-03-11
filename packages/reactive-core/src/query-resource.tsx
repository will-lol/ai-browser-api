import { Atom, useAtomRefresh, useAtomValue } from "@effect-atom/atom-react";
import * as Reactivity from "@effect/experimental/Reactivity";
import * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";
import { useCallback } from "react";
import type { ReactiveRuntime } from "./runtime";
import {
  toReactiveQueryState,
  type ReactiveAtomResult,
  type ReactiveQueryState,
} from "./state";

type ResourceRequirements<Services> =
  | Services
  | Reactivity.Reactivity
  | Scope.Scope;

export type QueryResource<Value, Error> = {
  readonly atom: Atom.Atom<ReactiveAtomResult<Value, Error>>;
};

function normalizeKey(
  key: string | ReadonlyArray<string> | undefined,
): ReadonlyArray<string> {
  if (typeof key === "undefined") {
    return [];
  }

  return typeof key === "string" ? [key] : key;
}

export function createQueryResource<
  Services,
  RuntimeError,
  Value,
  Error,
  Requirements extends ResourceRequirements<Services>,
>(
  runtime: ReactiveRuntime<Services, RuntimeError>,
  options: {
    key?: string | ReadonlyArray<string>;
    load: Effect.Effect<Value, Error, Requirements>;
  },
): QueryResource<Value, Error | RuntimeError> {
  const keys = normalizeKey(options.key);
  const atom = runtime.atomRuntime.atom(options.load);

  return {
    atom:
      keys.length > 0 ? atom.pipe(Atom.withReactivity(keys)) : atom,
  };
}

export function useQueryResourceResult<Value, Error>(
  resource: QueryResource<Value, Error>,
) {
  return useAtomValue(resource.atom);
}

export function useQueryResourceState<Value>(
  resource: QueryResource<Value, unknown>,
): ReactiveQueryState<Value> {
  return toReactiveQueryState(useQueryResourceResult(resource));
}

export function useQueryResourceRefresh<Value, Error>(
  resource: QueryResource<Value, Error>,
) {
  const refresh = useAtomRefresh(resource.atom);
  return useCallback(async () => {
    refresh();
  }, [refresh]);
}

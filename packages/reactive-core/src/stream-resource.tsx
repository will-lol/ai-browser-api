import { Atom } from "@effect-atom/atom-react";
import type * as Stream from "effect/Stream";
import type { ReactiveRuntime } from "./runtime";
import type { ReactiveAtomResult } from "./state";

type ResourceRequirements<Services> = Services;

export type StreamResource<Value, Error> = {
  readonly atom: Atom.Atom<ReactiveAtomResult<Value, Error>>;
};

export function createStreamResource<
  Services,
  RuntimeError,
  Value,
  Error,
  Requirements extends ResourceRequirements<Services>,
>(
  runtime: ReactiveRuntime<Services, RuntimeError>,
  options: {
    load: Stream.Stream<Value, Error, Requirements>;
    initialValue?: Value;
  },
): StreamResource<Value, Error | RuntimeError> {
  return {
    atom: runtime.atomRuntime.atom(
      options.load,
      typeof options.initialValue === "undefined"
        ? undefined
        : {
            initialValue: options.initialValue,
          },
    ),
  };
}

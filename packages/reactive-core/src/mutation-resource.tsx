import { Atom, useAtomSet } from "@effect-atom/atom-react";
import * as Reactivity from "@effect/experimental/Reactivity";
import * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";
import { useCallback, useState } from "react";
import type { ReactiveRuntime } from "./runtime";

type ResourceRequirements<Services> =
  | Services
  | Reactivity.Reactivity
  | Scope.Scope;

export type MutationResource<Input, Output, Failure> = {
  readonly atom: Atom.AtomResultFn<Input, Output, Failure>;
};

function toError(error: unknown) {
  return error instanceof Error ? error : new Error(String(error));
}

export function createMutationResource<
  Services,
  RuntimeError,
  Input,
  Output,
  MutationError,
  Requirements extends ResourceRequirements<Services>,
>(
  runtime: ReactiveRuntime<Services, RuntimeError>,
  options: {
    run: (input: Input) => Effect.Effect<Output, MutationError, Requirements>;
    invalidate?:
      | ReadonlyArray<string>
      | ((input: Input, result: Output) => ReadonlyArray<string>);
  },
) {
  const atom: Atom.AtomResultFn<Input, Output, MutationError | RuntimeError> =
    runtime.atomRuntime.fn(
    Effect.fn(function* (input: Input) {
      const result = yield* options.run(input);
      const keys =
        typeof options.invalidate === "function"
          ? options.invalidate(input, result)
          : (options.invalidate ?? []);

      if (keys.length > 0) {
        yield* Reactivity.invalidate(keys);
      }

      return result;
    }),
  );

  return {
    atom,
  };
}

export type ReactiveMutationState<Input, Output> = {
  execute: (input: Input) => Promise<Output>;
  error: Error | null;
  isPending: boolean;
  reset: () => void;
};

export function useMutationResource<Input, Output, Failure>(
  resource: MutationResource<Input, Output, Failure>,
): ReactiveMutationState<Input, Output> {
  const executeAtom = useAtomSet(resource.atom, {
    mode: "promise",
  });
  const [error, setError] = useState<Error | null>(null);
  const [isPending, setIsPending] = useState(false);

  const execute = useCallback(async (input: Input) => {
    setError(null);
    setIsPending(true);

    try {
      return await executeAtom(input);
    } catch (cause) {
      const nextError = toError(cause);
      setError(nextError);
      throw nextError;
    } finally {
      setIsPending(false);
    }
  }, [executeAtom]);

  const reset = useCallback(() => {
    setError(null);
  }, []);

  return {
    execute,
    error,
    isPending,
    reset,
  };
}

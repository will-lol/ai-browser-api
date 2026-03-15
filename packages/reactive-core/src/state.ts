import { Result } from "@effect-atom/atom-react";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";

export type ReactiveAtomResult<Value, Error> = Result.Result<Value, Error>;

export type ReactiveStatus = "loading" | "ready" | "error";

export type ReactiveQueryState<Value> = {
  status: ReactiveStatus;
  value: Value | null;
  error: Error | null;
  isLoading: boolean;
  isReady: boolean;
  hasError: boolean;
};

function toError(error: unknown) {
  if (error instanceof Error) {
    return error;
  }

  return new Error(String(error));
}

function toResultError(error: unknown) {
  return Cause.isCause(error) ? toError(Cause.squash(error)) : toError(error);
}

function toFailureValue<Value, Error>(
  result: Extract<ReactiveAtomResult<Value, Error>, { _tag: "Failure" }>,
) {
  return Option.isSome(result.previousSuccess)
    ? result.previousSuccess.value.value
    : null;
}

export function toReactiveQueryState<Value>(
  result: ReactiveAtomResult<Value, unknown>,
): ReactiveQueryState<Value> {
  console.log(result);
  if (Result.isInitial(result)) {
    return {
      status: "loading",
      value: null,
      error: null,
      isLoading: true,
      isReady: false,
      hasError: false,
    };
  }

  if (Result.isSuccess(result)) {
    return {
      status: result.waiting ? "loading" : "ready",
      value: result.value,
      error: null,
      isLoading: result.waiting,
      isReady: !result.waiting,
      hasError: false,
    };
  }

  if (result.waiting) {
    return {
      status: "loading",
      value: toFailureValue(result),
      error: null,
      isLoading: true,
      isReady: false,
      hasError: false,
    };
  }

  return {
    status: "error",
    value: toFailureValue(result),
    error: toResultError(result.cause),
    isLoading: false,
    isReady: false,
    hasError: true,
  };
}

type StateValue<T> = T extends ReactiveQueryState<infer Value> ? Value : never;

function canCombineStates<
  T extends Record<string, ReactiveQueryState<unknown>>,
>(states: T) {
  return Object.values(states).every((state) => state.value !== null);
}

function combineStateValues<
  T extends Record<string, ReactiveQueryState<unknown>>,
>(states: T): { [Key in keyof T]: StateValue<T[Key]> } | null {
  if (!canCombineStates(states)) {
    return null;
  }

  const combined = {} as { [Key in keyof T]: StateValue<T[Key]> };
  for (const [key, state] of Object.entries(states) as Array<
    [keyof T, T[keyof T]]
  >) {
    combined[key] = state.value as StateValue<T[keyof T]>;
  }
  return combined;
}

export function combineQueryStates<
  T extends Record<string, ReactiveQueryState<unknown>>,
>(states: T): ReactiveQueryState<{ [Key in keyof T]: StateValue<T[Key]> }> {
  const firstError = Object.values(states).find((state) => state.hasError);
  if (firstError) {
    return {
      status: "error",
      value: combineStateValues(states),
      error: firstError.error,
      isLoading: false,
      isReady: false,
      hasError: true,
    };
  }

  const isLoading = Object.values(states).some((state) => state.isLoading);
  if (isLoading) {
    return {
      status: "loading",
      value: combineStateValues(states),
      error: null,
      isLoading: true,
      isReady: false,
      hasError: false,
    };
  }

  return {
    status: "ready",
    value: combineStateValues(states),
    error: null,
    isLoading: false,
    isReady: true,
    hasError: false,
  };
}

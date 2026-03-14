import * as Mailbox from "effect/Mailbox";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Scope from "effect/Scope";

type DetachedOptions = {
  label?: string;
  onError?: (error: unknown) => void;
};

function defaultOnError(error: unknown, label?: string) {
  console.warn(
    label
      ? `[extension-transport] ${label} failed`
      : "[extension-transport] detached effect failed",
    error,
  );
}

export function runDetachedTransportServerEffect(
  effect: Effect.Effect<unknown, unknown>,
  options?: DetachedOptions,
) {
  void Effect.runPromise(effect).catch(
    options?.onError ?? ((error) => defaultOnError(error, options?.label)),
  );
}

export function offerMailboxFromCallback<A, E>(
  mailbox: Mailbox.Mailbox<A, E>,
  value: A,
  options?: DetachedOptions,
) {
  runDetachedTransportServerEffect(
    mailbox.offer(value).pipe(Effect.asVoid),
    options,
  );
}

export function makeOnceTransportCleanup<Reason>(
  cleanup: (reason: Reason) => Effect.Effect<void, unknown>,
) {
  let cleaned = false;

  return (reason: Reason): Effect.Effect<void, never> => {
    if (cleaned) {
      return Effect.void;
    }

    cleaned = true;
    return cleanup(reason).pipe(Effect.catchAll(() => Effect.void));
  };
}

export function closeScopeQuietly(
  scope: Scope.CloseableScope,
  exit: Exit.Exit<unknown, unknown> = Exit.void,
) {
  return Scope.close(scope, exit).pipe(Effect.catchAll(() => Effect.void));
}

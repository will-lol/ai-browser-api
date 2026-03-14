import * as Effect from "effect/Effect";

export function runDetachedRuntimeRpcClientEffect(
  effect: Effect.Effect<unknown, unknown>,
  options?: {
    onError?: (error: unknown) => void;
  },
) {
  void Effect.runPromise(effect).catch(
    options?.onError ??
      ((error) => {
        console.warn("[runtime-rpc-client] detached effect failed", error);
      }),
  );
}

import { RuntimeDefectError } from "@llm-bridge/contracts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

function toRuntimeDefect(defect: unknown) {
  return new RuntimeDefectError({
    defect: String(defect),
  });
}

export function runClientTransport<A, E>(effect: Effect.Effect<A, E>) {
  return Effect.runPromise(
    effect.pipe(
      Effect.catchAllDefect((defect) => Effect.fail(toRuntimeDefect(defect))),
    ),
  );
}

export function runDetachedClientTransport(
  effect: Effect.Effect<unknown, unknown>,
  options?: {
    onError?: (error: unknown) => void;
  },
) {
  void runClientTransport(effect).catch(
    options?.onError ??
      ((error) => {
        console.warn("[bridge-client] detached transport effect failed", error);
      }),
  );
}

export function effectStreamToReadableStream<A, E>(
  effect: Effect.Effect<Stream.Stream<A, E>, E>,
) {
  return runClientTransport(
    Effect.scoped(
      Effect.flatMap(effect, (stream) => Stream.toReadableStreamEffect(stream)),
    ),
  );
}

export function attachAbortEffect(input: {
  signal?: AbortSignal;
  effect: Effect.Effect<void, unknown>;
  onError?: (error: unknown) => void;
}) {
  if (!input.signal) {
    return () => undefined;
  }

  const onAbort = () => {
    runDetachedClientTransport(input.effect, {
      onError: input.onError,
    });
  };

  input.signal.addEventListener("abort", onAbort, { once: true });

  return () => {
    input.signal?.removeEventListener("abort", onAbort);
  };
}

export function createReadableStreamFromReader<A, B>(input: {
  reader: ReadableStreamDefaultReader<A>;
  map: (value: A) => B;
  onReadError?: (error: unknown) => unknown;
  onClose?: () => void;
  onCancel?: () => Promise<void> | void;
  cleanup?: () => void;
}): ReadableStream<B> {
  let cleanedUp = false;

  const cleanup = () => {
    if (cleanedUp) {
      return;
    }

    cleanedUp = true;
    input.cleanup?.();
  };

  return new ReadableStream<B>({
    async pull(controller) {
      try {
        const next = await input.reader.read();
        if (next.done) {
          input.onClose?.();
          cleanup();
          controller.close();
          return;
        }

        controller.enqueue(input.map(next.value));
      } catch (error) {
        cleanup();
        const handled = input.onReadError ? input.onReadError(error) : error;
        throw handled instanceof Error ? handled : toRuntimeDefect(handled);
      }
    },
    async cancel() {
      try {
        await input.reader.cancel();
      } finally {
        try {
          await input.onCancel?.();
        } finally {
          cleanup();
        }
      }
    },
  });
}

export async function probeReadableStream<A>(stream: ReadableStream<A>) {
  const [probeStream, consumerStream] = stream.tee();
  const reader = probeStream.getReader();

  try {
    await reader.read();
    return consumerStream;
  } finally {
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export async function bufferReadableStreamPrefix<A, B>(input: {
  reader: ReadableStreamDefaultReader<A>;
  map: (value: A) => B;
  keepBuffering: (value: B) => boolean;
}) {
  const buffered = [] as Array<B>;

  while (true) {
    const next = await input.reader.read();
    if (next.done) {
      return {
        buffered,
        done: true,
      } as const;
    }

    const mapped = input.map(next.value);
    buffered.push(mapped);
    if (!input.keepBuffering(mapped)) {
      return {
        buffered,
        done: false,
      } as const;
    }
  }
}

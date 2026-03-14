import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import {
  bufferReadableStreamPrefix,
  effectStreamToReadableStream,
  probeReadableStream,
  runClientTransport,
  runDetachedClientTransport,
} from "./transport-boundary";

async function readAll<A>(stream: ReadableStream<A>) {
  const reader = stream.getReader();
  const values = [] as Array<A>;

  while (true) {
    const next = await reader.read();
    if (next.done) {
      return values;
    }

    values.push(next.value);
  }
}

describe("transport-boundary", () => {
  it("wraps escaped defects as RuntimeDefectError", async () => {
    await assert.rejects(
      () => runClientTransport(Effect.die("boom")),
      /RuntimeDefectError/,
    );
  });

  it("logs detached failures through the provided handler", async () => {
    const failure = await new Promise<unknown>((resolve) => {
      runDetachedClientTransport(Effect.fail(new Error("detached boom")), {
        onError: resolve,
      });
    });

    assert.equal(failure instanceof Error, true);
    if (failure instanceof Error) {
      assert.equal(failure.message, "detached boom");
    }
  });

  it("releases the scoped stream resource when the readable stream finishes", async () => {
    let released = false;

    const readable = await effectStreamToReadableStream(
      Effect.succeed(
        Stream.acquireRelease(Effect.succeed("resource"), () =>
          Effect.sync(() => {
            released = true;
          }),
        ).pipe(
          Stream.flatMap(() => Stream.make(1)),
        ),
      ),
    );

    assert.deepEqual(await readAll(readable), [1]);
    assert.equal(released, true);
  });

  it("preserves the first chunk when probing a readable stream", async () => {
    const stream = new ReadableStream<number>({
      start(controller) {
        controller.enqueue(1);
        controller.enqueue(2);
        controller.close();
      },
    });

    const probed = await probeReadableStream(stream);

    assert.deepEqual(await readAll(probed), [1, 2]);
  });

  it("buffers the bootstrap prefix until the first non-bootstrap chunk", async () => {
    const stream = new ReadableStream<string>({
      start(controller) {
        controller.enqueue("bootstrap-1");
        controller.enqueue("bootstrap-2");
        controller.enqueue("content");
      },
    });

    const result = await bufferReadableStreamPrefix({
      reader: stream.getReader(),
      map: (value) => value,
      keepBuffering: (value) => value !== "content",
    });

    assert.deepEqual(result, {
      buffered: ["bootstrap-1", "bootstrap-2", "content"],
      done: false,
    });
  });
});

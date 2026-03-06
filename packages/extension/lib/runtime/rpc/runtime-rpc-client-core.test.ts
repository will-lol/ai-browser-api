import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RuntimePublicRpcGroup } from "@llm-bridge/contracts";
import {
  makeRuntimeRpcClientCore,
  type RuntimePort,
} from "./runtime-rpc-client-core";

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;

  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });

  return {
    promise,
    resolve,
    reject,
  };
}

async function flushMicrotasks(times = 5) {
  for (let index = 0; index < times; index += 1) {
    await Promise.resolve();
  }
}

function createFakePort(): RuntimePort & {
  emitDisconnect: () => void;
  getDisconnectCalls: () => number;
  getDisconnectListenerCount: () => number;
} {
  const messageListeners = new Set<(payload: never) => void>();
  const disconnectListeners = new Set<() => void>();
  let disconnectCalls = 0;

  return {
    onMessage: {
      addListener: (listener) => {
        messageListeners.add(listener as (payload: never) => void);
      },
      removeListener: (listener) => {
        messageListeners.delete(listener as (payload: never) => void);
      },
    },
    onDisconnect: {
      addListener: (listener) => {
        disconnectListeners.add(listener as () => void);
      },
      removeListener: (listener) => {
        disconnectListeners.delete(listener as () => void);
      },
    },
    postMessage: () => undefined,
    disconnect: () => {
      disconnectCalls += 1;
    },
    emitDisconnect: () => {
      for (const listener of [...disconnectListeners]) {
        listener();
      }
    },
    getDisconnectCalls: () => disconnectCalls,
    getDisconnectListenerCount: () => disconnectListeners.size,
  };
}

function createWindowLike() {
  const listeners = new Set<() => void>();

  return {
    addEventListener: (
      type: "pagehide",
      listener: () => void,
      _options?: AddEventListenerOptions,
    ) => {
      assert.equal(type, "pagehide");
      listeners.add(listener);
    },
    emitPagehide: () => {
      for (const listener of [...listeners]) {
        listener();
      }
    },
    getListenerCount: () => listeners.size,
  };
}

describe("makeRuntimeRpcClientCore", () => {
  it("coalesces concurrent cold-start callers to one connect call", async () => {
    const started = createDeferred<void>();
    const release = createDeferred<void>();
    const ports: Array<ReturnType<typeof createFakePort>> = [];
    let connectCalls = 0;

    const core = makeRuntimeRpcClientCore({
      portName: "test-port",
      rpcGroup: RuntimePublicRpcGroup,
      invalidatedError: () => new Error("invalidated"),
      connect: () => {
        connectCalls += 1;
        const port = createFakePort();
        ports.push(port);
        return port;
      },
      beforeReady: async ({ connectionId }) => {
        if (connectionId !== 1) return;
        started.resolve();
        await release.promise;
      },
    });

    const first = core.ensureConnection();
    const second = core.ensureConnection();

    await started.promise;
    assert.equal(connectCalls, 1);

    release.resolve();

    const [connectionA, connectionB] = await Promise.all([first, second]);
    assert.equal(connectionA.connectionId, 1);
    assert.strictEqual(connectionA.port, ports[0]);
    assert.strictEqual(connectionA, connectionB);
  });

  it("does not let a stale port disconnect tear down a newer connection", async () => {
    const started = createDeferred<void>();
    const release = createDeferred<void>();
    const ports: Array<ReturnType<typeof createFakePort>> = [];

    const core = makeRuntimeRpcClientCore({
      portName: "test-port",
      rpcGroup: RuntimePublicRpcGroup,
      invalidatedError: () => new Error("invalidated"),
      connect: () => {
        const port = createFakePort();
        ports.push(port);
        return port;
      },
      beforeReady: async ({ connectionId }) => {
        if (connectionId !== 1) return;
        started.resolve();
        await release.promise;
      },
    });

    const firstAttempt = core.ensureConnection().then(
      () => {
        throw new Error("expected first attempt to fail");
      },
      (error) => error,
    );

    await started.promise;
    ports[0]?.emitDisconnect();

    const firstError = await firstAttempt;
    assert.equal((firstError as Error).message, "invalidated");

    release.resolve();
    await flushMicrotasks();

    const second = await core.ensureConnection();
    assert.equal(second.connectionId, 2);
    assert.strictEqual(second.port, ports[1]);
    assert.equal(ports[1]?.getDisconnectCalls(), 0);

    ports[0]?.emitDisconnect();

    const reused = await core.ensureConnection();
    assert.strictEqual(reused.port, ports[1]);
    assert.equal(ports[1]?.getDisconnectCalls(), 0);
  });

  it("disconnect during connect invalidates waiters and prevents publishing the dead connection", async () => {
    const started = createDeferred<void>();
    const release = createDeferred<void>();
    const ports: Array<ReturnType<typeof createFakePort>> = [];

    const core = makeRuntimeRpcClientCore({
      portName: "test-port",
      rpcGroup: RuntimePublicRpcGroup,
      invalidatedError: () => new Error("invalidated"),
      connect: () => {
        const port = createFakePort();
        ports.push(port);
        return port;
      },
      beforeReady: async ({ connectionId }) => {
        if (connectionId !== 1) return;
        started.resolve();
        await release.promise;
      },
    });

    const waiting = core.ensureConnection().then(
      () => {
        throw new Error("expected ensureConnection to reject");
      },
      (error) => error,
    );

    await started.promise;
    ports[0]?.emitDisconnect();

    const firstError = await waiting;
    assert.equal((firstError as Error).message, "invalidated");

    release.resolve();
    await flushMicrotasks();

    const second = await core.ensureConnection();
    assert.equal(second.connectionId, 2);
    assert.strictEqual(second.port, ports[1]);
    assert.equal(ports[0]?.getDisconnectListenerCount(), 0);
  });

  it("reconnects after pagehide destroys the current connection", async () => {
    const ports: Array<ReturnType<typeof createFakePort>> = [];
    const windowLike = createWindowLike();

    const core = makeRuntimeRpcClientCore({
      portName: "test-port",
      rpcGroup: RuntimePublicRpcGroup,
      invalidatedError: () => new Error("invalidated"),
      connect: () => {
        const port = createFakePort();
        ports.push(port);
        return port;
      },
      windowLike,
    });

    const first = await core.ensureConnection();
    windowLike.emitPagehide();
    await flushMicrotasks();

    assert.equal(ports[0]?.getDisconnectCalls(), 1);

    const second = await core.ensureConnection();
    assert.equal(second.connectionId, 2);
    assert.notStrictEqual(second.port, first.port);
  });

  it("registers the pagehide listener once per core instance", async () => {
    const windowLike = createWindowLike();

    const core = makeRuntimeRpcClientCore({
      portName: "test-port",
      rpcGroup: RuntimePublicRpcGroup,
      invalidatedError: () => new Error("invalidated"),
      connect: () => createFakePort(),
      windowLike,
    });

    assert.equal(windowLike.getListenerCount(), 1);

    await core.ensureConnection();
    await core.destroyConnection("destroy");
    await core.ensureConnection();

    assert.equal(windowLike.getListenerCount(), 1);
  });
});

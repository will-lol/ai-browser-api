import assert from "node:assert/strict";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { mock } from "@/test-utils/vitest-compat";
import type { FromClientEncoded } from "@effect/rpc/RpcMessage";
import {
  PAGE_BRIDGE_INIT_MESSAGE,
  PAGE_BRIDGE_PORT_CONTROL_MESSAGE,
} from "@llm-bridge/contracts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

const listModelsCalls: Array<Record<string, unknown>> = [];

mock.module("@/content/bridge/runtime-public-rpc-client", () => ({
  getRuntimePublicRPC: () => ({
    listModels: (input: Record<string, unknown>) =>
      Effect.sync(() => {
        listModelsCalls.push(input);
        return [];
      }),
    getOriginState: () => Effect.die("unused"),
    listPending: () => Effect.die("unused"),
    acquireModel: () => Effect.die("unused"),
    modelDoGenerate: () => Effect.die("unused"),
    modelDoStream: () => Stream.empty,
    abortModelCall: () => Effect.void,
    chatSendMessages: () => Stream.empty,
    chatReconnectStream: () => Stream.empty,
    abortChatStream: () => Effect.void,
    createPermissionRequest: () => Effect.die("unused"),
  }),
}));

const { setupPageApiBridge } = await import("./page-api-bridge");

type WindowListener = (event: { type: string; [key: string]: unknown }) => void;

class FakeMessagePort {
  readonly messageListeners = new Set<
    (event: { data: unknown }) => void
  >();
  readonly messageErrorListeners = new Set<
    (event: { data?: unknown }) => void
  >();
  readonly postedMessages: Array<unknown> = [];
  startCalls = 0;
  closeCalls = 0;
  throwOnPostMessage = false;

  addEventListener(
    type: "message" | "messageerror",
    listener: (event: { data?: unknown }) => void,
  ) {
    if (type === "message") {
      this.messageListeners.add(listener as (event: { data: unknown }) => void);
      return;
    }

    this.messageErrorListeners.add(listener);
  }

  removeEventListener(
    type: "message" | "messageerror",
    listener: (event: { data?: unknown }) => void,
  ) {
    if (type === "message") {
      this.messageListeners.delete(
        listener as (event: { data: unknown }) => void,
      );
      return;
    }

    this.messageErrorListeners.delete(listener);
  }

  start() {
    this.startCalls += 1;
  }

  postMessage(message: unknown) {
    if (this.throwOnPostMessage) {
      throw new Error("post failed");
    }

    this.postedMessages.push(message);
  }

  close() {
    this.closeCalls += 1;
  }

  emitMessage(data: unknown) {
    for (const listener of [...this.messageListeners]) {
      listener({ data });
    }
  }

  emitMessageError() {
    for (const listener of [...this.messageErrorListeners]) {
      listener({});
    }
  }
}

function makeRequest(
  tag: string,
  payload: Record<string, unknown>,
): FromClientEncoded {
  return {
    _tag: "Request",
    id: "1",
    tag,
    payload,
    headers: {},
  } as const as FromClientEncoded;
}

function createFakeWindow(origin: string) {
  const listeners = new Map<string, Set<WindowListener>>();
  const dispatchedEvents: Array<string> = [];

  const getListeners = (type: string) => {
    const existing = listeners.get(type);
    if (existing) {
      return existing;
    }

    const next = new Set<WindowListener>();
    listeners.set(type, next);
    return next;
  };

  return {
    location: {
      origin,
    },
    addEventListener(type: string, listener: WindowListener) {
      getListeners(type).add(listener);
    },
    removeEventListener(type: string, listener: WindowListener) {
      getListeners(type).delete(listener);
    },
    dispatchEvent(event: { type: string }) {
      dispatchedEvents.push(event.type);
      for (const listener of [...getListeners(event.type)]) {
        listener(event);
      }
      return true;
    },
    emitMessage(event: {
      source: unknown;
      data: unknown;
      ports: ReadonlyArray<unknown>;
    }) {
      for (const listener of [...getListeners("message")]) {
        listener({
          type: "message",
          ...event,
        });
      }
    },
    emitPagehide() {
      for (const listener of [...getListeners("pagehide")]) {
        listener({
          type: "pagehide",
        });
      }
    },
    getListenerCount(type: string) {
      return getListeners(type).size;
    },
    getDispatchedEvents() {
      return [...dispatchedEvents];
    },
  };
}

const originalWindow = Reflect.get(globalThis, "window");
const originalDocument = Reflect.get(globalThis, "document");
let currentWindow!: ReturnType<typeof createFakeWindow>;
let currentDocument!: {
  documentElement: {
    dataset: Record<string, string>;
  };
};

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 250,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) {
      return;
    }

    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }

  throw new Error("Timed out waiting for condition");
}

beforeEach(() => {
  listModelsCalls.length = 0;

  currentWindow = createFakeWindow("https://page.test");
  currentDocument = {
    documentElement: {
      dataset: {},
    },
  };

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: currentWindow,
  });

  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: currentDocument,
  });
});

afterAll(() => {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: originalWindow,
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: originalDocument,
  });
  mock.restore();
});

describe("setupPageApiBridge", () => {
  it("initializes one session per init port, even for duplicate init messages", async () => {
    const fakePort = new FakeMessagePort();

    setupPageApiBridge();

    currentWindow.emitMessage({
      source: currentWindow,
      data: { type: PAGE_BRIDGE_INIT_MESSAGE },
      ports: [fakePort],
    });
    currentWindow.emitMessage({
      source: currentWindow,
      data: { type: PAGE_BRIDGE_INIT_MESSAGE },
      ports: [fakePort],
    });

    await waitFor(() => fakePort.startCalls === 1);
    expect(fakePort.messageListeners.size).toBe(1);
    expect(fakePort.messageErrorListeners.size).toBe(1);
  });

  it("ignores non-init and wrong-source messages", async () => {
    const wrongSource = {};
    const fakePort = new FakeMessagePort();

    setupPageApiBridge();

    currentWindow.emitMessage({
      source: wrongSource,
      data: { type: PAGE_BRIDGE_INIT_MESSAGE },
      ports: [fakePort],
    });
    currentWindow.emitMessage({
      source: currentWindow,
      data: { type: "other" },
      ports: [fakePort],
    });

    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(fakePort.startCalls).toBe(0);
    expect(fakePort.messageListeners.size).toBe(0);
  });

  it("cleans up exactly once on control disconnect", async () => {
    const fakePort = new FakeMessagePort();

    setupPageApiBridge();

    currentWindow.emitMessage({
      source: currentWindow,
      data: { type: PAGE_BRIDGE_INIT_MESSAGE },
      ports: [fakePort],
    });
    await waitFor(() => fakePort.startCalls === 1);

    const disconnectMessage = {
      _tag: PAGE_BRIDGE_PORT_CONTROL_MESSAGE,
      type: "disconnect",
    };

    fakePort.emitMessage(disconnectMessage);
    fakePort.emitMessage(disconnectMessage);

    await waitFor(() => fakePort.closeCalls === 1);
    expect(fakePort.messageListeners.size).toBe(0);
    expect(fakePort.messageErrorListeners.size).toBe(0);
  });

  it("cleans up exactly once on messageerror", async () => {
    const fakePort = new FakeMessagePort();

    setupPageApiBridge();

    currentWindow.emitMessage({
      source: currentWindow,
      data: { type: PAGE_BRIDGE_INIT_MESSAGE },
      ports: [fakePort],
    });
    await waitFor(() => fakePort.startCalls === 1);

    fakePort.emitMessageError();
    fakePort.emitMessageError();

    await waitFor(() => fakePort.closeCalls === 1);
    fakePort.emitMessage(
      makeRequest("listModels", {
        connectedOnly: true,
      }),
    );
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(listModelsCalls.length).toBe(0);
  });

  it("cleans up exactly once when sending a response fails", async () => {
    const fakePort = new FakeMessagePort();
    fakePort.throwOnPostMessage = true;

    setupPageApiBridge();

    currentWindow.emitMessage({
      source: currentWindow,
      data: { type: PAGE_BRIDGE_INIT_MESSAGE },
      ports: [fakePort],
    });
    await waitFor(() => fakePort.startCalls === 1);

    fakePort.emitMessage(
      makeRequest("listModels", {
        connectedOnly: true,
      }),
    );

    await waitFor(() => fakePort.closeCalls === 1);
    expect(listModelsCalls).toHaveLength(1);
  });

  it("tears down all active sessions on pagehide", async () => {
    const firstPort = new FakeMessagePort();
    const secondPort = new FakeMessagePort();

    setupPageApiBridge();

    currentWindow.emitMessage({
      source: currentWindow,
      data: { type: PAGE_BRIDGE_INIT_MESSAGE },
      ports: [firstPort],
    });
    currentWindow.emitMessage({
      source: currentWindow,
      data: { type: PAGE_BRIDGE_INIT_MESSAGE },
      ports: [secondPort],
    });

    await waitFor(() => firstPort.startCalls === 1 && secondPort.startCalls === 1);
    currentWindow.emitPagehide();

    await waitFor(() => firstPort.closeCalls === 1 && secondPort.closeCalls === 1);
  });

  it("injects window.location.origin into runtime public rpc calls", async () => {
    const fakePort = new FakeMessagePort();

    setupPageApiBridge();

    currentWindow.emitMessage({
      source: currentWindow,
      data: { type: PAGE_BRIDGE_INIT_MESSAGE },
      ports: [fakePort],
    });
    await waitFor(() => fakePort.startCalls === 1);

    fakePort.emitMessage(
      makeRequest("listModels", {
        connectedOnly: true,
      }),
    );

    await waitFor(() => listModelsCalls.length === 1);
    expect(listModelsCalls[0]).toEqual({
      origin: "https://page.test",
      connectedOnly: true,
      providerID: undefined,
    });
    expect(currentDocument.documentElement.dataset.llmBridgeReady).toBe("true");
    assert.equal(
      currentWindow.getDispatchedEvents().includes("llm-bridge-ready"),
      true,
    );
  });
});

import assert from "node:assert/strict";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FromClientEncoded } from "@effect/rpc/RpcMessage";
import {
  RUNTIME_ADMIN_RPC_PORT_NAME,
  RuntimeAdminAllowedTags,
  RuntimeAdminRpcGroup,
  RuntimeCreatePermissionRequestInputSchema,
  RUNTIME_PUBLIC_RPC_PORT_NAME,
  RuntimePublicAllowedTags,
  RuntimePublicRpcGroup,
} from "@llm-bridge/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

const EXTENSION_ID = "test-extension";
const EXTENSION_URL = "https://extension.test/";
const PUBLIC_ORIGIN = "https://example.test";

type FakeRuntimePort = {
  readonly name: string;
  readonly sender: Record<string, unknown>;
  readonly onMessage: {
    addListener: (listener: (payload: FromClientEncoded) => void) => void;
    removeListener: (listener: (payload: FromClientEncoded) => void) => void;
  };
  readonly onDisconnect: {
    addListener: (listener: () => void) => void;
    removeListener: (listener: () => void) => void;
  };
  readonly postMessageCalls: Array<unknown>;
  disconnectCalls: number;
  emitMessage: (payload: FromClientEncoded) => void;
  emitDisconnect: () => void;
  getMessageListenerCount: () => number;
  getDisconnectListenerCount: () => number;
  postMessage: (payload: unknown) => void;
  disconnect: () => void;
};

const onConnectListeners = new Set<(port: FakeRuntimePort) => void>();

vi.doMock("@wxt-dev/browser", () => ({
  browser: {
    runtime: {
      id: EXTENSION_ID,
      getURL: (_path: string) => EXTENSION_URL,
      onConnect: {
        addListener(listener: (port: FakeRuntimePort) => void) {
          onConnectListeners.add(listener);
        },
        removeListener(listener: (port: FakeRuntimePort) => void) {
          onConnectListeners.delete(listener);
        },
      },
    },
  },
}));

const {
  authorizeRuntimeRpcConnect,
  authorizeRuntimeRpcRequest,
  registerRuntimeRpcServer,
} = await import("./runtime-rpc-server");

function makeRequest(
  tag: string,
  payload: Record<string, unknown>,
): FromClientEncoded {
  return {
    _tag: "Request",
    id: "req_1",
    tag,
    payload,
    headers: {},
  } as const as FromClientEncoded;
}

function createFakeRuntimePort(input: {
  name: string;
  sender: Record<string, unknown>;
}): FakeRuntimePort {
  const messageListeners = new Set<(payload: FromClientEncoded) => void>();
  const disconnectListeners = new Set<() => void>();
  const postMessageCalls: Array<unknown> = [];

  return {
    name: input.name,
    sender: input.sender,
    onMessage: {
      addListener(listener) {
        messageListeners.add(listener);
      },
      removeListener(listener) {
        messageListeners.delete(listener);
      },
    },
    onDisconnect: {
      addListener(listener) {
        disconnectListeners.add(listener);
      },
      removeListener(listener) {
        disconnectListeners.delete(listener);
      },
    },
    postMessageCalls,
    disconnectCalls: 0,
    emitMessage(payload) {
      for (const listener of [...messageListeners]) {
        listener(payload);
      }
    },
    emitDisconnect() {
      for (const listener of [...disconnectListeners]) {
        listener();
      }
    },
    getMessageListenerCount: () => messageListeners.size,
    getDisconnectListenerCount: () => disconnectListeners.size,
    postMessage(payload: unknown) {
      postMessageCalls.push(payload);
    },
    disconnect() {
      this.disconnectCalls += 1;
    },
  };
}

function makePublicLayer() {
  return RuntimePublicRpcGroup.toLayer(
    Effect.succeed(
      RuntimePublicRpcGroup.of({
        listModels: () => Effect.die("unused"),
        streamModels: () => Stream.empty,
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
    ),
  );
}

function makeAdminLayer() {
  return RuntimeAdminRpcGroup.toLayer(
    Effect.succeed(
      RuntimeAdminRpcGroup.of({
        listModels: () => Effect.die("unused"),
        streamModels: () => Stream.empty,
        getOriginState: () => Effect.die("unused"),
        streamOriginState: () => Stream.empty,
        listPending: () => Effect.die("unused"),
        streamPending: () => Stream.empty,
        acquireModel: () => Effect.die("unused"),
        modelDoGenerate: () => Effect.die("unused"),
        modelDoStream: () => Stream.empty,
        abortModelCall: () => Effect.void,
        chatSendMessages: () => Stream.empty,
        chatReconnectStream: () => Stream.empty,
        abortChatStream: () => Effect.void,
        createPermissionRequest: () => Effect.die("unused"),
        listProviders: () => Effect.die("unused"),
        streamProviders: () => Stream.empty,
        listConnectedModels: () => Effect.die("unused"),
        listPermissions: () => Effect.die("unused"),
        streamPermissions: () => Stream.empty,
        openProviderAuthWindow: () => Effect.die("unused"),
        getProviderAuthFlow: () => Effect.die("unused"),
        streamProviderAuthFlow: () => Stream.empty,
        startProviderAuthFlow: () => Effect.die("unused"),
        cancelProviderAuthFlow: () => Effect.die("unused"),
        disconnectProvider: () => Effect.die("unused"),
        setOriginEnabled: () => Effect.die("unused"),
        setModelPermission: () => Effect.die("unused"),
        resolvePermissionRequest: () => Effect.die("unused"),
        dismissPermissionRequest: () => Effect.die("unused"),
      }),
    ),
  );
}

async function startServer() {
  return Effect.runPromise(
    registerRuntimeRpcServer({
      publicLayer: makePublicLayer(),
      adminLayer: makeAdminLayer(),
    }),
  );
}

function emitConnect(port: FakeRuntimePort) {
  for (const listener of [...onConnectListeners]) {
    listener(port);
  }
}

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
  onConnectListeners.clear();
});

describe("runtime rpc server policy", () => {
  it("derives allowed tags from the bound rpc group", () => {
    const publicTags = RuntimePublicAllowedTags;
    const adminTags = RuntimeAdminAllowedTags;

    assert.equal(new Set<string>(publicTags).has("listProviders"), false);
    assert.equal(adminTags.has("listProviders"), true);
  });

  it("rejects public requests when the payload origin does not match the sender origin", async () => {
    const context = await Effect.runPromise(
      authorizeRuntimeRpcConnect({
        role: "public",
        sender: {
          id: EXTENSION_ID,
          url: `${PUBLIC_ORIGIN}/page`,
          tab: {
            id: 1,
          },
        } as never,
        extensionID: EXTENSION_ID,
        extensionURL: EXTENSION_URL,
      }),
    );

    await assert.rejects(
      Effect.runPromise(
        authorizeRuntimeRpcRequest({
          allowedTags: RuntimePublicAllowedTags,
          context,
          message: makeRequest("listModels", {
            origin: "https://other.test",
          }),
        }),
      ),
      /RPC origin does not match caller sender origin/,
    );
  });

  it("rejects admin-only tags on the public port using the derived tag set", async () => {
    const context = await Effect.runPromise(
      authorizeRuntimeRpcConnect({
        role: "public",
        sender: {
          id: EXTENSION_ID,
          url: `${PUBLIC_ORIGIN}/page`,
          tab: {
            id: 1,
          },
        } as never,
        extensionID: EXTENSION_ID,
        extensionURL: EXTENSION_URL,
      }),
    );

    await assert.rejects(
      Effect.runPromise(
        authorizeRuntimeRpcRequest({
          allowedTags: RuntimePublicAllowedTags,
          context,
          message: makeRequest("listProviders", {
            origin: PUBLIC_ORIGIN,
          }),
        }),
      ),
      /RPC method is not available for this caller/,
    );
  });

  it("lets malformed public createPermissionRequest through policy and leaves rejection to schema validation", async () => {
    const context = await Effect.runPromise(
      authorizeRuntimeRpcConnect({
        role: "public",
        sender: {
          id: EXTENSION_ID,
          url: `${PUBLIC_ORIGIN}/page`,
          tab: {
            id: 1,
          },
        } as never,
        extensionID: EXTENSION_ID,
        extensionURL: EXTENSION_URL,
      }),
    );

    const malformedPayload = {
      origin: PUBLIC_ORIGIN,
      action: "resolve",
      requestId: "prm_1",
      decision: "allowed",
    } as const;

    await Effect.runPromise(
      authorizeRuntimeRpcRequest({
        allowedTags: RuntimePublicAllowedTags,
        context,
        message: makeRequest("createPermissionRequest", malformedPayload),
      }),
    );

    const decodePublic = Schema.decodeUnknownSync(
      RuntimeCreatePermissionRequestInputSchema,
    );

    assert.throws(() => decodePublic(malformedPayload), /modelId/);
  });

  it("disconnects clients when request authorization fails", async () => {
    const dispose = await startServer();
    const port = createFakeRuntimePort({
      name: RUNTIME_PUBLIC_RPC_PORT_NAME,
      sender: {
        id: EXTENSION_ID,
        url: `${PUBLIC_ORIGIN}/page`,
        tab: {
          id: 1,
        },
      },
    });

    try {
      emitConnect(port);
      expect(port.getMessageListenerCount()).toBe(1);

      port.emitMessage(
        makeRequest("listModels", {
          origin: "https://other.test",
        }),
      );

      await waitFor(() => port.disconnectCalls === 1);
      expect(port.getMessageListenerCount()).toBe(0);
      expect(port.getDisconnectListenerCount()).toBe(0);
    } finally {
      await Effect.runPromise(dispose);
    }
  });

  it("removes session listeners when the port disconnects", async () => {
    const dispose = await startServer();
    const port = createFakeRuntimePort({
      name: RUNTIME_PUBLIC_RPC_PORT_NAME,
      sender: {
        id: EXTENSION_ID,
        url: `${PUBLIC_ORIGIN}/page`,
        tab: {
          id: 1,
        },
      },
    });

    try {
      emitConnect(port);
      expect(port.getMessageListenerCount()).toBe(1);
      expect(port.getDisconnectListenerCount()).toBe(1);

      port.emitDisconnect();
      await waitFor(
        () =>
          port.getMessageListenerCount() === 0 &&
          port.getDisconnectListenerCount() === 0,
      );

      expect(port.disconnectCalls).toBe(0);
    } finally {
      await Effect.runPromise(dispose);
    }
  });

  it("removes the root onConnect listeners on cleanup", async () => {
    const dispose = await startServer();

    expect(onConnectListeners.size).toBe(2);

    await Effect.runPromise(dispose);
    expect(onConnectListeners.size).toBe(0);
  });

  it("keeps public and admin ports split by port name", async () => {
    const dispose = await startServer();
    const publicPort = createFakeRuntimePort({
      name: RUNTIME_PUBLIC_RPC_PORT_NAME,
      sender: {
        id: EXTENSION_ID,
        url: `${PUBLIC_ORIGIN}/page`,
        tab: {
          id: 1,
        },
      },
    });
    const adminPort = createFakeRuntimePort({
      name: RUNTIME_ADMIN_RPC_PORT_NAME,
      sender: {
        id: EXTENSION_ID,
        url: `${EXTENSION_URL}popup.html`,
      },
    });

    try {
      emitConnect(publicPort);
      emitConnect(adminPort);

      expect(publicPort.getMessageListenerCount()).toBe(1);
      expect(adminPort.getMessageListenerCount()).toBe(1);
    } finally {
      await Effect.runPromise(dispose);
    }
  });
});

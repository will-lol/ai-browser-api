import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type OAuthCallbackRequestListener,
  type OAuthCallbackRequestDetails,
  type OAuthWebRequestOnBeforeRequest,
  waitForOAuthCallback,
} from "@/lib/runtime/plugins/oauth-browser-callback-util";

type Listener = OAuthCallbackRequestListener;

function createOnBeforeRequestHarness(input?: { throwOnAdd?: Error }) {
  let listener: Listener | undefined;
  let removeCalls = 0;
  let addFilter: unknown;

  const onBeforeRequest = {
    addListener(nextListener: Listener, filter: unknown) {
      addFilter = filter;
      if (input?.throwOnAdd) {
        throw input.throwOnAdd;
      }
      listener = nextListener;
    },
    removeListener(nextListener: Listener) {
      if (!listener || listener === nextListener) {
        removeCalls += 1;
      }
    },
  } as unknown as OAuthWebRequestOnBeforeRequest;

  return {
    onBeforeRequest,
    getListener() {
      return listener;
    },
    getRemoveCalls() {
      return removeCalls;
    },
    getAddFilter() {
      return addFilter;
    },
  };
}

function buildOptions(input?: {
  onBeforeRequest?: OAuthWebRequestOnBeforeRequest;
  signal?: AbortSignal;
  timeoutMs?: number;
  onListenerArmed?: () => void;
  onIntercepted?: (url: string) => void;
}) {
  return {
    onBeforeRequest: input?.onBeforeRequest,
    signal: input?.signal,
    urlPattern: "http://localhost:1455/auth/callback*",
    matchesUrl: (url: string) =>
      url.startsWith("http://localhost:1455/auth/callback"),
    timeoutMs: input?.timeoutMs ?? 2_000,
    unsupportedErrorMessage: "custom unsupported message",
    timeoutErrorMessage: "custom timeout message",
    registerListenerErrorPrefix: "custom register failure",
    onListenerArmed: input?.onListenerArmed,
    onIntercepted: input?.onIntercepted,
  };
}

describe("waitForOAuthCallback", () => {
  it("resolves on main_frame callback, emits hooks, and cleans listener once", async () => {
    const harness = createOnBeforeRequestHarness();
    let armedCalls = 0;
    let interceptedUrl: string | undefined;

    const wait = waitForOAuthCallback(
      buildOptions({
        onBeforeRequest: harness.onBeforeRequest,
        onListenerArmed: () => {
          armedCalls += 1;
        },
        onIntercepted: (url) => {
          interceptedUrl = url;
        },
      }),
    );

    const listener = harness.getListener();
    assert.ok(listener);
    assert.deepEqual(harness.getAddFilter(), {
      urls: ["http://localhost:1455/auth/callback*"],
      types: ["main_frame"],
    });

    const callbackUrl =
      "http://localhost:1455/auth/callback?code=abc&state=xyz";
    listener({
      type: "main_frame",
      url: callbackUrl,
    } as OAuthCallbackRequestDetails);

    assert.equal(await wait, callbackUrl);
    assert.equal(armedCalls, 1);
    assert.equal(interceptedUrl, callbackUrl);
    assert.equal(harness.getRemoveCalls(), 1);
  });

  it("ignores non-main_frame requests", async () => {
    const harness = createOnBeforeRequestHarness();
    const wait = waitForOAuthCallback(
      buildOptions({
        onBeforeRequest: harness.onBeforeRequest,
      }),
    );
    const listener = harness.getListener();
    assert.ok(listener);

    let resolved = false;
    void wait.then(() => {
      resolved = true;
    });

    listener({
      type: "xmlhttprequest",
      url: "http://localhost:1455/auth/callback?code=ignored",
    } as OAuthCallbackRequestDetails);
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(resolved, false);

    listener({
      type: "main_frame",
      url: "http://localhost:1455/auth/callback?code=final",
    } as OAuthCallbackRequestDetails);
    await wait;
  });

  it("ignores non-matching urls", async () => {
    const harness = createOnBeforeRequestHarness();
    const wait = waitForOAuthCallback(
      buildOptions({
        onBeforeRequest: harness.onBeforeRequest,
      }),
    );
    const listener = harness.getListener();
    assert.ok(listener);

    let resolved = false;
    void wait.then(() => {
      resolved = true;
    });

    listener({
      type: "main_frame",
      url: "http://localhost:1455/auth/other?code=ignored",
    } as OAuthCallbackRequestDetails);
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(resolved, false);

    listener({
      type: "main_frame",
      url: "http://localhost:1455/auth/callback?code=final",
    } as OAuthCallbackRequestDetails);
    await wait;
  });

  it("throws provider-defined unsupported error when webRequest is unavailable", async () => {
    await assert.rejects(
      () =>
        waitForOAuthCallback(
          buildOptions({
            onBeforeRequest: undefined,
          }),
        ),
      /custom unsupported message/,
    );
  });

  it("returns prefixed listener registration errors", async () => {
    const harness = createOnBeforeRequestHarness({
      throwOnAdd: new Error("listener registration boom"),
    });

    await assert.rejects(
      () =>
        waitForOAuthCallback(
          buildOptions({
            onBeforeRequest: harness.onBeforeRequest,
          }),
        ),
      /custom register failure: listener registration boom/,
    );
    assert.equal(harness.getRemoveCalls(), 1);
  });

  it("rejects on abort and cleans listener", async () => {
    const harness = createOnBeforeRequestHarness();
    const controller = new AbortController();

    const wait = waitForOAuthCallback(
      buildOptions({
        onBeforeRequest: harness.onBeforeRequest,
        signal: controller.signal,
      }),
    );
    controller.abort();

    await assert.rejects(() => wait, /Authentication canceled/);
    assert.equal(harness.getRemoveCalls(), 1);
  });

  it("rejects on timeout and cleans listener", async () => {
    const harness = createOnBeforeRequestHarness();

    await assert.rejects(
      () =>
        waitForOAuthCallback(
          buildOptions({
            onBeforeRequest: harness.onBeforeRequest,
            timeoutMs: 20,
          }),
        ),
      /custom timeout message/,
    );
    assert.equal(harness.getRemoveCalls(), 1);
  });
});

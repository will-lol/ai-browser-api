import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RuntimeEventPayload } from "@/background/events/runtime-events";
import {
  mergePendingChangedRequestIds,
  waitForPermissionDecisionEventDriven,
} from "@/background/runtime/permission-wait";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pendingChanged(requestIds: string[]): RuntimeEventPayload {
  return {
    type: "runtime.pending.changed",
    payload: {
      origin: "https://example.test",
      requestIds,
    },
  };
}

function permissionsChanged(): RuntimeEventPayload {
  return {
    type: "runtime.permissions.changed",
    payload: {
      origin: "https://example.test",
      modelIds: ["provider/model"],
    },
  };
}

function createHarness() {
  let handler: ((event: RuntimeEventPayload) => void) | undefined;
  let unsubscribeCalls = 0;

  return {
    subscribe(next: (event: RuntimeEventPayload) => void) {
      handler = next;
      return () => {
        unsubscribeCalls += 1;
        if (handler === next) {
          handler = undefined;
        }
      };
    },
    emit(event: RuntimeEventPayload) {
      handler?.(event);
    },
    getUnsubscribeCalls() {
      return unsubscribeCalls;
    },
  };
}

describe("permission wait utility", () => {
  it("resolves immediately when request is already not pending", async () => {
    const harness = createHarness();
    let checks = 0;

    const result = await waitForPermissionDecisionEventDriven({
      requestId: "req-1",
      timeoutMs: 50,
      isPending: async () => {
        checks += 1;
        return false;
      },
      subscribe: harness.subscribe,
    });

    assert.equal(result, "resolved");
    assert.equal(checks, 1);
    assert.equal(harness.getUnsubscribeCalls(), 0);
  });

  it("ignores unrelated events and resolves on matching pending change", async () => {
    const harness = createHarness();
    let pending = true;

    const wait = waitForPermissionDecisionEventDriven({
      requestId: "req-2",
      timeoutMs: 250,
      isPending: async () => pending,
      subscribe: harness.subscribe,
    });

    let settled = false;
    void wait.then(() => {
      settled = true;
    });

    harness.emit(permissionsChanged());
    harness.emit(pendingChanged(["other-request"]));

    await sleep(0);
    await sleep(0);
    assert.equal(settled, false);

    pending = false;
    harness.emit(pendingChanged(["req-2"]));

    assert.equal(await wait, "resolved");
    assert.equal(harness.getUnsubscribeCalls(), 1);
  });

  it("returns timeout when request stays pending", async () => {
    const harness = createHarness();

    const result = await waitForPermissionDecisionEventDriven({
      requestId: "req-3",
      timeoutMs: 20,
      isPending: async () => true,
      subscribe: harness.subscribe,
    });

    assert.equal(result, "timeout");
    assert.equal(harness.getUnsubscribeCalls(), 1);
  });

  it("returns aborted and unsubscribes when signal aborts", async () => {
    const harness = createHarness();
    const controller = new AbortController();

    const wait = waitForPermissionDecisionEventDriven({
      requestId: "req-4",
      timeoutMs: 1_000,
      signal: controller.signal,
      isPending: async () => true,
      subscribe: harness.subscribe,
    });

    await sleep(0);
    controller.abort();

    assert.equal(await wait, "aborted");
    assert.equal(harness.getUnsubscribeCalls(), 1);
  });

  it("handles resolve race between initial check and listener arm", async () => {
    const harness = createHarness();
    let checks = 0;

    const result = await waitForPermissionDecisionEventDriven({
      requestId: "req-5",
      timeoutMs: 250,
      isPending: async () => {
        checks += 1;
        return checks === 1;
      },
      subscribe: harness.subscribe,
    });

    assert.equal(result, "resolved");
    assert.ok(checks >= 2);
    assert.equal(harness.getUnsubscribeCalls(), 1);
  });

  it("merges stale request IDs into pending changed payload", () => {
    assert.deepEqual(
      mergePendingChangedRequestIds("req-new", ["req-stale-a", "req-stale-b"]),
      ["req-new", "req-stale-a", "req-stale-b"],
    );
    assert.deepEqual(
      mergePendingChangedRequestIds("req-new", [
        "req-new",
        "req-stale-a",
        "req-stale-a",
      ]),
      ["req-new", "req-stale-a"],
    );
  });
});

import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  RuntimeAdminRpcGroup,
  RuntimeAdminAllowedTags,
  RuntimePublicRpcGroup,
  RuntimePublicAllowedTags,
} from "./runtime-rpc";
import { PageBridgeRpcGroup } from "./page-bridge-rpc";

describe("runtime rpc contract", () => {
  it("keeps the page bridge aligned with the public rpc surface", () => {
    assert.deepEqual(
      new Set(PageBridgeRpcGroup.requests.keys()),
      new Set(RuntimePublicRpcGroup.requests.keys()),
    );
  });

  it("keeps public access as a strict subset of admin access", () => {
    for (const tag of RuntimePublicAllowedTags) {
      assert.equal(RuntimeAdminAllowedTags.has(tag), true);
    }
    assert.equal(RuntimePublicAllowedTags.size, RuntimePublicRpcGroup.requests.size);
    assert.equal(RuntimeAdminAllowedTags.size, RuntimeAdminRpcGroup.requests.size);
  });
});

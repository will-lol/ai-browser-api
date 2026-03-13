import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  RuntimeAdminRpcGroup,
  RuntimeAdminAllowedTags,
  RuntimePublicRpcGroup,
  RuntimePublicAllowedTags,
} from "./runtime-rpc";
import { PageBridgeRpcGroup } from "./page-bridge-rpc";

describe("runtime rpc contract", () => {
  it("uses the public rpc group for the page bridge", () => {
    assert.equal(PageBridgeRpcGroup, RuntimePublicRpcGroup);
  });

  it("keeps public access as a strict subset of admin access", () => {
    for (const tag of RuntimePublicAllowedTags) {
      assert.equal(RuntimeAdminAllowedTags.has(tag), true);
    }
    assert.equal(RuntimePublicAllowedTags.size, RuntimePublicRpcGroup.requests.size);
    assert.equal(RuntimeAdminAllowedTags.size, RuntimeAdminRpcGroup.requests.size);
  });
});

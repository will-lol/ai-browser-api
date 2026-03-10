import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  RuntimeAdminAllowedTags,
  RuntimePublicAllowedTags,
  RuntimeRpcGroup,
} from "./runtime-rpc";
import { PageBridgeRpcGroup } from "./page-bridge-rpc";

describe("runtime rpc contract", () => {
  it("uses one canonical rpc group across runtime and page bridge", () => {
    assert.equal(PageBridgeRpcGroup, RuntimeRpcGroup);
  });

  it("keeps public access as a strict subset of admin access", () => {
    for (const tag of RuntimePublicAllowedTags) {
      assert.equal(RuntimeAdminAllowedTags.has(tag), true);
    }
    assert.equal(RuntimeAdminAllowedTags.size, RuntimeRpcGroup.requests.size);
  });
});

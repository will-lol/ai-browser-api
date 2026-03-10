import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FromClientEncoded } from "@effect/rpc/RpcMessage";
import {
  RuntimeAdminAllowedTags,
  RuntimeCreatePermissionRequestInputSchema,
  RuntimePublicAllowedTags,
} from "@llm-bridge/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import {
  authorizeRuntimeRpcConnect,
  authorizeRuntimeRpcRequest,
} from "./runtime-rpc-server";

const EXTENSION_ID = "test-extension";
const EXTENSION_URL = "https://extension.test/";
const PUBLIC_ORIGIN = "https://example.test";

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
});

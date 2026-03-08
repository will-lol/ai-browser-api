import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RpcClientError } from "@effect/rpc/RpcClientError";
import * as Schema from "effect/Schema";
import {
  RuntimeUpstreamServiceError,
  RuntimeRpcErrorSchema,
  RuntimeCreatePermissionRequestInputSchema,
  RuntimeRequestPermissionInputSchema,
  RuntimeAdminRpcGroup,
  RuntimePublicRpcGroup,
} from "./index";

const EXPECTED_PUBLIC_TAGS = new Set([
  "listModels",
  "getOriginState",
  "listPending",
  "requestPermission",
  "acquireModel",
  "modelDoGenerate",
  "modelDoStream",
  "abortModelCall",
  "chatSendMessages",
  "chatReconnectStream",
  "abortChatStream",
]);

const EXPECTED_ADMIN_TAGS = new Set([
  "listProviders",
  "listModels",
  "listConnectedModels",
  "getOriginState",
  "listPermissions",
  "listPending",
  "openProviderAuthWindow",
  "getProviderAuthFlow",
  "startProviderAuthFlow",
  "cancelProviderAuthFlow",
  "disconnectProvider",
  "updatePermission",
  "requestPermission",
  "acquireModel",
  "modelDoGenerate",
  "modelDoStream",
  "abortModelCall",
  "chatSendMessages",
  "chatReconnectStream",
  "abortChatStream",
]);

const SHARED_TAGS = [
  "listModels",
  "getOriginState",
  "listPending",
  "acquireModel",
  "modelDoGenerate",
  "modelDoStream",
  "abortModelCall",
  "chatSendMessages",
  "chatReconnectStream",
  "abortChatStream",
] as const;

describe("runtime rpc contracts", () => {
  it("exposes the expected public and admin tag sets", () => {
    assert.deepEqual(
      new Set(RuntimePublicRpcGroup.requests.keys()),
      EXPECTED_PUBLIC_TAGS,
    );
    assert.deepEqual(
      new Set(RuntimeAdminRpcGroup.requests.keys()),
      EXPECTED_ADMIN_TAGS,
    );
  });

  it("shares every common rpc definition except requestPermission", () => {
    for (const tag of SHARED_TAGS) {
      assert.strictEqual(
        RuntimePublicRpcGroup.requests.get(tag),
        RuntimeAdminRpcGroup.requests.get(tag),
      );
    }

    assert.notStrictEqual(
      RuntimePublicRpcGroup.requests.get("requestPermission"),
      RuntimeAdminRpcGroup.requests.get("requestPermission"),
    );
  });

  it("keeps requestPermission as the only role-divergent contract", () => {
    const decodePublic = Schema.decodeUnknownSync(
      RuntimeCreatePermissionRequestInputSchema,
    );
    const decodeAdmin = Schema.decodeUnknownSync(
      RuntimeRequestPermissionInputSchema,
    );

    assert.throws(
      () =>
        decodePublic({
          origin: "https://example.test",
          action: "resolve",
          requestId: "prm_1",
          decision: "allowed",
        }),
      /create/,
    );

    assert.deepEqual(
      decodeAdmin({
        action: "resolve",
        requestId: "prm_1",
        decision: "allowed",
      }),
      {
        action: "resolve",
        requestId: "prm_1",
        decision: "allowed",
      },
    );
  });

  it("encodes and decodes upstream errors with optional response headers", () => {
    const decodeRuntimeError = Schema.decodeUnknownSync(RuntimeRpcErrorSchema);
    const encodeRuntimeError = Schema.encodeSync(RuntimeRpcErrorSchema);

    const withHeaders = decodeRuntimeError({
      _tag: "RuntimeUpstreamServiceError",
      providerID: "openai",
      operation: "generate",
      statusCode: 429,
      responseHeaders: {
        "retry-after-ms": "12500",
      },
      retryable: true,
      message: "Rate limited",
    });

    assert.ok(withHeaders instanceof RuntimeUpstreamServiceError);
    assert.deepEqual(withHeaders.responseHeaders, {
      "retry-after-ms": "12500",
    });
    assert.deepEqual(encodeRuntimeError(withHeaders), {
      _tag: "RuntimeUpstreamServiceError",
      providerID: "openai",
      operation: "generate",
      statusCode: 429,
      responseHeaders: {
        "retry-after-ms": "12500",
      },
      retryable: true,
      message: "Rate limited",
    });

    const withoutHeaders = decodeRuntimeError({
      _tag: "RuntimeUpstreamServiceError",
      providerID: "openai",
      operation: "stream",
      retryable: false,
      message: "Upstream failed",
    });

    assert.ok(withoutHeaders instanceof RuntimeUpstreamServiceError);
    assert.equal(withoutHeaders.responseHeaders, undefined);
    assert.deepEqual(encodeRuntimeError(withoutHeaders), {
      _tag: "RuntimeUpstreamServiceError",
      providerID: "openai",
      operation: "stream",
      retryable: false,
      message: "Upstream failed",
    });
  });
});

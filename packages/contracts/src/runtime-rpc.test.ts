import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RpcClientError } from "@effect/rpc/RpcClientError";
import * as Schema from "effect/Schema";
import {
  RuntimeRpcErrorSchema,
  RuntimeThrownError,
  RuntimeTransportError,
  RuntimeUnknownValueError,
  RuntimeCreatePermissionRequestInputSchema,
  RuntimeRequestPermissionInputSchema,
  RuntimeAdminRpcGroup,
  RuntimePublicRpcGroup,
  serializeRpcClientError,
  serializeUnknownRuntimeError,
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
]);

const SHARED_TAGS = [
  "listModels",
  "getOriginState",
  "listPending",
  "acquireModel",
  "modelDoGenerate",
  "modelDoStream",
  "abortModelCall",
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

  it("serializes native errors into RuntimeThrownError", () => {
    const serialized = serializeUnknownRuntimeError(
      new TypeError("bad payload"),
    );

    assert.deepEqual(
      Schema.decodeUnknownSync(RuntimeRpcErrorSchema)(serialized),
      serialized,
    );
    assert.equal(serialized._tag, "RuntimeThrownError");
    assert.equal(serialized.name, "TypeError");
    assert.equal(serialized.message, "bad payload");
  });

  it("serializes rpc client errors into RuntimeTransportError", () => {
    const serialized = serializeRpcClientError(
      new RpcClientError({
        reason: "Protocol",
        message: "failed to post",
        cause: new Error("boom"),
      }),
      "rpc-client",
    );

    assert.deepEqual(
      Schema.decodeUnknownSync(RuntimeRpcErrorSchema)(serialized),
      serialized,
    );
    assert.equal(serialized._tag, "RuntimeTransportError");
    assert.equal(serialized.reason, "Protocol");
  });

  it("serializes non-error thrown values into RuntimeUnknownValueError", () => {
    const serialized = serializeUnknownRuntimeError({
      status: "weird",
    });

    assert.deepEqual(
      Schema.decodeUnknownSync(RuntimeRpcErrorSchema)(serialized),
      serialized,
    );
    assert.equal(serialized._tag, "RuntimeUnknownValueError");
    assert.equal(serialized.value, "[object Object]");
  });
});

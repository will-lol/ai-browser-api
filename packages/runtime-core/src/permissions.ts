import {
  AuthFlowExpiredError,
  PermissionDeniedError,
  RuntimeValidationError,
  type RuntimeCreatePermissionRequestResponse,
  type RuntimeDismissPermissionRequestResponse,
  type RuntimeResolvePermissionRequestResponse,
  type RuntimeSetOriginEnabledResponse,
  type RuntimeUpdatePermissionResponse,
} from "@llm-bridge/contracts";
import * as Effect from "effect/Effect";
import { RuntimeEnvironment, type AppEffect } from "./environment";

export function getOriginState(origin: string) {
  return Effect.flatMap(RuntimeEnvironment, (env) =>
    env.permissions.getOriginState(origin),
  );
}

export function listPermissions(origin: string) {
  return Effect.flatMap(RuntimeEnvironment, (env) =>
    env.permissions.listPermissions(origin),
  );
}

export function listPending(origin: string) {
  return Effect.flatMap(RuntimeEnvironment, (env) =>
    env.pending.listPending(origin),
  );
}

export function ensureOriginEnabled(origin: string): AppEffect<void> {
  return Effect.gen(function* () {
    const env = yield* RuntimeEnvironment;
    const state = yield* env.permissions.getOriginState(origin);
    if (state.enabled) {
      return;
    }
    return yield* new RuntimeValidationError({
      message: `Origin ${origin} is disabled`,
    });
  });
}

export function ensureModelAccess(input: {
  origin: string;
  modelID: string;
  signal?: AbortSignal;
}): AppEffect<void> {
  return Effect.gen(function* () {
    const env = yield* RuntimeEnvironment;
    const permission = yield* env.permissions.getModelPermission(
      input.origin,
      input.modelID,
    );
    if (permission === "allowed") {
      return;
    }

    const target = yield* env.meta.resolvePermissionTarget(input.modelID);
    const result = yield* env.permissions.createPermissionRequest({
      origin: input.origin,
      modelId: target.modelId,
      provider: target.provider,
      modelName: target.modelName,
      capabilities: target.capabilities,
    });

    if (result.status === "alreadyAllowed") {
      return;
    }

    const waitResult = yield* env.permissions.waitForPermissionDecision(
      result.request.id,
      undefined,
      input.signal,
    );
    if (waitResult === "timeout") {
      return yield* new AuthFlowExpiredError({
        providerID: target.provider,
        message: "Permission request timed out",
      });
    }
    if (waitResult === "aborted") {
      return yield* new RuntimeValidationError({
        message: "Request canceled",
      });
    }

    const updated = yield* env.permissions.getModelPermission(
      input.origin,
      input.modelID,
    );
    if (updated !== "allowed") {
      return yield* new PermissionDeniedError({
        origin: input.origin,
        modelId: input.modelID,
        message: "Permission denied",
      });
    }
  });
}

export function setOriginEnabled(
  origin: string,
  enabled: boolean,
): AppEffect<RuntimeSetOriginEnabledResponse> {
  return Effect.flatMap(RuntimeEnvironment, (env) =>
    env.permissions.setOriginEnabled(origin, enabled),
  );
}

export function setModelPermission(input: {
  origin: string;
  modelID: string;
  status: "allowed" | "denied";
  capabilities?: ReadonlyArray<string>;
}): AppEffect<RuntimeUpdatePermissionResponse> {
  return Effect.flatMap(RuntimeEnvironment, (env) =>
    env.permissions.setModelPermission(input),
  );
}

export function createPermissionRequest(input: {
  origin: string;
  modelId: string;
}): AppEffect<RuntimeCreatePermissionRequestResponse> {
  return Effect.gen(function* () {
    const env = yield* RuntimeEnvironment;
    const target = yield* env.meta.resolvePermissionTarget(input.modelId);
    return yield* env.permissions.createPermissionRequest({
      origin: input.origin,
      modelId: target.modelId,
      modelName: target.modelName,
      provider: target.provider,
      capabilities: target.capabilities,
    });
  });
}

export function resolvePermissionRequest(input: {
  requestId: string;
  decision: "allowed" | "denied";
}): AppEffect<RuntimeResolvePermissionRequestResponse> {
  return Effect.flatMap(RuntimeEnvironment, (env) =>
    env.permissions.resolvePermissionRequest(input),
  );
}

export function dismissPermissionRequest(
  requestId: string,
): AppEffect<RuntimeDismissPermissionRequestResponse> {
  return Effect.flatMap(RuntimeEnvironment, (env) =>
    env.permissions.dismissPermissionRequest(requestId),
  );
}

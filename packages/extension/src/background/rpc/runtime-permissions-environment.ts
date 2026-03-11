import * as Effect from "effect/Effect";
import type { RuntimeEnvironmentApi } from "@llm-bridge/runtime-core";
import { getOriginState, listPermissionsForOrigin } from "@/background/runtime/query/query-service";
import {
  createPermissionRequest,
  dismissPermissionRequest,
  getModelPermission,
  resolvePermissionRequest,
  setModelPermission,
  setOriginEnabled,
  waitForPermissionDecision,
} from "@/background/runtime/permissions";

export function makeRuntimePermissionsEnvironment(): RuntimeEnvironmentApi["permissions"] {
  return {
    getOriginState,
    listPermissions: listPermissionsForOrigin,
    getModelPermission: (origin: string, modelID: string) =>
      getModelPermission(origin, modelID),
    setOriginEnabled: (origin: string, enabled: boolean) =>
      setOriginEnabled(origin, enabled).pipe(
        Effect.as({
          origin,
          enabled,
        }),
      ),
    setModelPermission: (input: {
      origin: string;
      modelID: string;
      status: "allowed" | "denied";
      capabilities?: ReadonlyArray<string>;
    }) =>
      setModelPermission(
          input.origin,
          input.modelID,
          input.status,
          input.capabilities ? [...input.capabilities] : undefined,
        ).pipe(
        Effect.as({
          origin: input.origin,
          modelId: input.modelID,
          status: input.status,
        }),
      ),
    createPermissionRequest: (input: {
      origin: string;
      modelId: string;
      provider: string;
      modelName: string;
      capabilities?: ReadonlyArray<string>;
    }) =>
      createPermissionRequest({
          ...input,
          capabilities: input.capabilities ? [...input.capabilities] : undefined,
        }),
    resolvePermissionRequest: (input: {
      requestId: string;
      decision: "allowed" | "denied";
    }) =>
      resolvePermissionRequest(input.requestId, input.decision).pipe(
        Effect.as({
          requestId: input.requestId,
          decision: input.decision,
        }),
      ),
    dismissPermissionRequest: (requestId: string) =>
      dismissPermissionRequest(requestId).pipe(
        Effect.as({
          requestId,
        }),
      ),
    waitForPermissionDecision: (
      requestId: string,
      timeoutMs?: number,
      signal?: AbortSignal,
    ) =>
      waitForPermissionDecision(requestId, timeoutMs, signal),
  };
}

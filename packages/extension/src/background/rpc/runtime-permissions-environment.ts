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
import { tryStoragePromise } from "@/background/rpc/runtime-environment-shared";

export function makeRuntimePermissionsEnvironment(): RuntimeEnvironmentApi["permissions"] {
  return {
    getOriginState,
    listPermissions: listPermissionsForOrigin,
    getModelPermission: (origin: string, modelID: string) =>
      tryStoragePromise("permissions.getModelPermission", () =>
        getModelPermission(origin, modelID),
      ),
    setOriginEnabled: (origin: string, enabled: boolean) =>
      tryStoragePromise("permissions.setOriginEnabled", async () => {
        await setOriginEnabled(origin, enabled);
        return {
          origin,
          enabled,
        };
      }),
    setModelPermission: (input: {
      origin: string;
      modelID: string;
      status: "allowed" | "denied";
      capabilities?: ReadonlyArray<string>;
    }) =>
      tryStoragePromise("permissions.setModelPermission", async () => {
        await setModelPermission(
          input.origin,
          input.modelID,
          input.status,
          input.capabilities ? [...input.capabilities] : undefined,
        );
        return {
          origin: input.origin,
          modelId: input.modelID,
          status: input.status,
        };
      }),
    createPermissionRequest: (input: {
      origin: string;
      modelId: string;
      provider: string;
      modelName: string;
      capabilities?: ReadonlyArray<string>;
    }) =>
      tryStoragePromise("permissions.createPermissionRequest", () =>
        createPermissionRequest({
          ...input,
          capabilities: input.capabilities ? [...input.capabilities] : undefined,
        }),
      ),
    resolvePermissionRequest: (input: {
      requestId: string;
      decision: "allowed" | "denied";
    }) =>
      tryStoragePromise("permissions.resolvePermissionRequest", async () => {
        await resolvePermissionRequest(input.requestId, input.decision);
        return {
          requestId: input.requestId,
          decision: input.decision,
        };
      }),
    dismissPermissionRequest: (requestId: string) =>
      tryStoragePromise("permissions.dismissPermissionRequest", async () => {
        await dismissPermissionRequest(requestId);
        return {
          requestId,
        };
      }),
    waitForPermissionDecision: (
      requestId: string,
      timeoutMs?: number,
      signal?: AbortSignal,
    ) =>
      tryStoragePromise("permissions.waitForPermissionDecision", () =>
        waitForPermissionDecision(requestId, timeoutMs, signal),
      ),
  };
}

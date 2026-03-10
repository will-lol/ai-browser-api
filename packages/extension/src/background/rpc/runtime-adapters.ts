import {
  fromRuntimeModelCallOptions,
  toRuntimeGenerateResponse,
  toRuntimeStreamPart,
} from "@llm-bridge/bridge-codecs";
import {
  ModelNotFoundError,
  ProviderNotConnectedError,
  encodeSupportedUrls,
  type RuntimeRpcError,
  type RuntimeModelCallOptions,
  type RuntimeStreamPart,
  isRuntimeRpcError,
} from "@llm-bridge/contracts";
import {
  RuntimeEnvironment,
  type RuntimeEnvironmentApi,
} from "@llm-bridge/runtime-core";
import type { LanguageModelV3StreamPart } from "@ai-sdk/provider";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  getRuntimeModelDescriptor,
  runLanguageModelGenerate,
  runLanguageModelStream,
} from "@/background/runtime/ai/language-model-runtime";
import { getAuthFlowManager } from "@/background/runtime/auth-flow-manager";
import { wrapExtensionError, wrapStorageError } from "@/background/runtime/errors";
import { resolveTrustedPermissionTarget } from "@/background/runtime/permission-targets";
import {
  getOriginState,
  listModels,
  listPendingRequestsForOrigin,
  listPermissionsForOrigin,
  listProviders,
} from "@/background/runtime/query-service";
import { disconnectProvider } from "@/background/runtime/provider-auth";
import {
  ensureProviderCatalog,
  refreshProviderCatalog,
  refreshProviderCatalogForProvider,
} from "@/background/runtime/provider-registry";
import {
  createPermissionRequest,
  dismissPermissionRequest,
  getModelPermission,
  resolvePermissionRequest,
  setModelPermission,
  setOriginEnabled,
  waitForPermissionDecision,
} from "@/background/runtime/permissions";
import { parseProviderModel } from "@/background/runtime/util";

const tryPromise = <A>(
  tryFn: () => Promise<A>,
  onError: (error: unknown) => RuntimeRpcError,
) =>
  Effect.tryPromise({
    try: tryFn,
    catch: (error): RuntimeRpcError =>
      isRuntimeRpcError(error) ? error : onError(error),
  });

const tryExtensionPromise = <A>(operation: string, tryFn: () => Promise<A>) =>
  tryPromise(tryFn, (error) => wrapExtensionError(error, operation));

const tryStoragePromise = <A>(operation: string, tryFn: () => Promise<A>) =>
  tryPromise(tryFn, (error) => wrapStorageError(error, operation));

function mapStream(
  stream: ReadableStream<LanguageModelV3StreamPart>,
): ReadableStream<RuntimeStreamPart> {
  const reader = stream.getReader();

  return new ReadableStream<RuntimeStreamPart>({
    async pull(controller) {
      const chunk = await reader.read();
      if (chunk.done) {
        controller.close();
        return;
      }

      controller.enqueue(toRuntimeStreamPart(chunk.value));
    },
    async cancel() {
      await reader.cancel();
    },
  });
}

export function makeRuntimeCoreInfrastructureLayer() {
  const runtimeEnvironment = {
    providers: {
      listProviders,
    },
    models: {
      listModels,
    },
    auth: {
      openProviderAuthWindow: (providerID: string) =>
        tryExtensionPromise("auth.openProviderAuthWindow", () => {
          const manager = getAuthFlowManager();
          return manager.openProviderAuthWindow(providerID);
        }),
      getProviderAuthFlow: (providerID: string) =>
        tryExtensionPromise("auth.getProviderAuthFlow", async () => {
          const manager = getAuthFlowManager();
          return {
            providerID,
            result: await manager.getProviderAuthFlow(providerID),
          };
        }),
      startProviderAuthFlow: (input: {
        providerID: string;
        methodID: string;
        values?: Record<string, string>;
      }) =>
        tryExtensionPromise("auth.startProviderAuthFlow", async () => {
          const manager = getAuthFlowManager();
          return {
            providerID: input.providerID,
            result: await manager.startProviderAuthFlow(input),
          };
        }),
      cancelProviderAuthFlow: (input: {
        providerID: string;
        reason?: string;
      }) =>
        tryExtensionPromise("auth.cancelProviderAuthFlow", async () => {
          const manager = getAuthFlowManager();
          return {
            providerID: input.providerID,
            result: await manager.cancelProviderAuthFlow(input),
          };
        }),
      disconnectProvider: (providerID: string) =>
        tryExtensionPromise("auth.disconnectProvider", async () => {
          const manager = getAuthFlowManager();
          await manager
            .cancelProviderAuthFlow({
              providerID,
              reason: "disconnect",
            })
            .catch(() => {
              // Ignore cancellation failures and continue disconnecting stored auth.
            });

          await disconnectProvider(providerID);
          return {
            providerID,
            connected: false,
          };
        }),
    },
    permissions: {
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
            capabilities: input.capabilities
              ? [...input.capabilities]
              : undefined,
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
    },
    pending: {
      listPending: listPendingRequestsForOrigin,
    },
    meta: {
      parseProviderModel,
      resolvePermissionTarget: (modelID: string) =>
        tryExtensionPromise("meta.resolvePermissionTarget", async () => {
          await ensureProviderCatalog();
          const resolution = await resolveTrustedPermissionTarget(modelID);
          if (resolution.status === "resolved") {
            return resolution.target;
          }
          if (resolution.status === "disconnected") {
            throw new ProviderNotConnectedError({
              providerID: resolution.provider,
              message: `Provider ${resolution.provider} is not connected`,
            });
          }

          throw new ModelNotFoundError({
            modelId: modelID,
            message: `Model ${modelID} was not found`,
          });
        }),
    },
    modelExecution: {
      acquireModel: (input: {
        origin: string;
        sessionID: string;
        requestID: string;
        modelID: string;
      }) =>
        tryExtensionPromise("model.acquire", () =>
          getRuntimeModelDescriptor({
            modelID: input.modelID,
            origin: input.origin,
            sessionID: input.sessionID,
            requestID: input.requestID,
          }).then((descriptor) => ({
            specificationVersion: "v3",
            provider: descriptor.provider,
            modelId: descriptor.modelId,
            supportedUrls: encodeSupportedUrls(descriptor.supportedUrls),
          })),
        ),
      generateModel: (input: {
        origin: string;
        sessionID: string;
        requestID: string;
        modelID: string;
        options: RuntimeModelCallOptions;
        signal?: AbortSignal;
      }) =>
        tryExtensionPromise("model.generate", () =>
          runLanguageModelGenerate({
            modelID: input.modelID,
            origin: input.origin,
            sessionID: input.sessionID,
            requestID: input.requestID,
            options: fromRuntimeModelCallOptions(input.options),
            signal: input.signal,
          }).then((result) => toRuntimeGenerateResponse(result)),
        ),
      streamModel: (input: {
        origin: string;
        sessionID: string;
        requestID: string;
        modelID: string;
        options: RuntimeModelCallOptions;
        signal?: AbortSignal;
      }) =>
        tryExtensionPromise("model.stream", () =>
          runLanguageModelStream({
            modelID: input.modelID,
            origin: input.origin,
            sessionID: input.sessionID,
            requestID: input.requestID,
            options: fromRuntimeModelCallOptions(input.options),
            signal: input.signal,
          }).then((stream) => mapStream(stream)),
        ),
    },
    catalog: {
      ensureCatalog: () =>
        tryExtensionPromise("catalog.ensure", () => ensureProviderCatalog()),
      refreshCatalog: () =>
        tryExtensionPromise("catalog.refresh", () =>
          refreshProviderCatalog(),
        ).pipe(Effect.asVoid),
      refreshCatalogForProvider: (providerID: string) =>
        tryExtensionPromise("catalog.refreshProvider", () =>
          refreshProviderCatalogForProvider(providerID),
        ),
    },
  } satisfies RuntimeEnvironmentApi;

  return Layer.succeed(RuntimeEnvironment, runtimeEnvironment);
}

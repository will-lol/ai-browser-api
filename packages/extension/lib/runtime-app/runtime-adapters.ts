import {
  fromRuntimeModelCallOptions,
  toRuntimeGenerateResponse,
  toRuntimeStreamPart,
} from "@llm-bridge/bridge-codecs";
import {
  ModelNotFoundError,
  ProviderNotConnectedError,
  encodeSupportedUrls,
  type RuntimeModelCallOptions,
  type RuntimeStreamPart,
} from "@llm-bridge/contracts";
import {
  AuthRepository,
  CatalogRepository,
  MetaRepository,
  ModelExecutionRepository,
  ModelsRepository,
  PendingRequestsRepository,
  PermissionsRepository,
  ProvidersRepository,
  makeAuthRepository,
  makeCatalogRepository,
  makeMetaRepository,
  makeModelExecutionRepository,
  makeModelsRepository,
  makePendingRequestsRepository,
  makePermissionsRepository,
  makeProvidersRepository,
} from "@llm-bridge/runtime-core";
import type { LanguageModelV3StreamPart } from "@ai-sdk/provider";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  getRuntimeModelDescriptor,
  runLanguageModelGenerate,
  runLanguageModelStream,
} from "@/lib/runtime/ai/language-model-runtime";
import { getAuthFlowManager } from "@/lib/runtime/auth-flow-manager";
import { resolveTrustedPermissionTarget } from "@/lib/runtime/permission-targets";
import {
  getOriginState,
  listModels,
  listPendingRequestsForOrigin,
  listPermissionsForOrigin,
  listProviders,
} from "@/lib/runtime/query-service";
import { disconnectProvider } from "@/lib/runtime/provider-auth";
import {
  ensureProviderCatalog,
  refreshProviderCatalog,
  refreshProviderCatalogForProvider,
} from "@/lib/runtime/provider-registry";
import {
  createPermissionRequest,
  dismissPermissionRequest,
  getModelPermission,
  resolvePermissionRequest,
  setModelPermission,
  setOriginEnabled,
  waitForPermissionDecision,
} from "@/lib/runtime/permissions";
import { parseProviderModel } from "@/lib/runtime/util";

const tryPromise = <A>(tryFn: () => Promise<A>) =>
  Effect.tryPromise({
    try: tryFn,
    catch: (error) => error,
  });

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

// This layer bridges runtime-core repositories to extension primitives.
// Read paths stay on repositories; orchestration stays in runtime-core services.
export function makeRuntimeCoreInfrastructureLayer() {
  const ProvidersRepoLive = Layer.succeed(
    ProvidersRepository,
    makeProvidersRepository({
      listProviders,
    }),
  );

  const ModelsRepoLive = Layer.succeed(
    ModelsRepository,
    makeModelsRepository({
      listModels,
    }),
  );

  const AuthRepoLive = Layer.succeed(
    AuthRepository,
    makeAuthRepository({
      openProviderAuthWindow: (providerID: string) =>
        tryPromise(() => {
          const manager = getAuthFlowManager();
          return manager.openProviderAuthWindow(providerID);
        }),
      getProviderAuthFlow: (providerID: string) =>
        tryPromise(async () => {
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
        tryPromise(async () => {
          const manager = getAuthFlowManager();
          return {
            providerID: input.providerID,
            result: await manager.startProviderAuthFlow(input),
          };
        }),
      cancelProviderAuthFlow: (input: { providerID: string; reason?: string }) =>
        tryPromise(async () => {
          const manager = getAuthFlowManager();
          return {
            providerID: input.providerID,
            result: await manager.cancelProviderAuthFlow(input),
          };
        }),
      disconnectProvider: (providerID: string) =>
        tryPromise(async () => {
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
    }),
  );

  const PermissionsRepoLive = Layer.succeed(
    PermissionsRepository,
    makePermissionsRepository({
      getOriginState,
      listPermissions: listPermissionsForOrigin,
      getModelPermission: (origin: string, modelID: string) =>
        tryPromise(() => getModelPermission(origin, modelID)),
      setOriginEnabled: (origin: string, enabled: boolean) =>
        tryPromise(async () => {
          await setOriginEnabled(origin, enabled);
          return {
            origin,
            enabled,
          };
        }),
      updatePermission: (input: {
        origin: string;
        modelID: string;
        status: "allowed" | "denied";
        capabilities?: ReadonlyArray<string>;
      }) =>
        tryPromise(async () => {
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
        tryPromise(() =>
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
        tryPromise(async () => {
          await resolvePermissionRequest(input.requestId, input.decision);
          return {
            requestId: input.requestId,
            decision: input.decision,
          };
        }),
      dismissPermissionRequest: (requestId: string) =>
        tryPromise(async () => {
          await dismissPermissionRequest(requestId);
          return {
            requestId,
          };
        }),
      waitForPermissionDecision: (
        requestId: string,
        timeoutMs?: number,
        signal?: AbortSignal,
      ) => tryPromise(() => waitForPermissionDecision(requestId, timeoutMs, signal)),
    }),
  );

  const PendingRequestsRepoLive = Layer.succeed(
    PendingRequestsRepository,
    makePendingRequestsRepository({
      listPending: listPendingRequestsForOrigin,
    }),
  );

  const MetaRepoLive = Layer.succeed(
    MetaRepository,
    makeMetaRepository({
      parseProviderModel,
      resolvePermissionTarget: (modelID: string) =>
        tryPromise(async () => {
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
    }),
  );

  const ModelExecutionRepoLive = Layer.succeed(
    ModelExecutionRepository,
    makeModelExecutionRepository({
      acquireModel: (input: {
        origin: string;
        sessionID: string;
        requestID: string;
        modelID: string;
      }) =>
        tryPromise(() =>
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
        tryPromise(() =>
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
        tryPromise(() =>
          runLanguageModelStream({
            modelID: input.modelID,
            origin: input.origin,
            sessionID: input.sessionID,
            requestID: input.requestID,
            options: fromRuntimeModelCallOptions(input.options),
            signal: input.signal,
          }).then((stream) => mapStream(stream)),
        ),
    }),
  );

  const CatalogRepoLive = Layer.succeed(
    CatalogRepository,
    makeCatalogRepository({
      ensureCatalog: () => tryPromise(() => ensureProviderCatalog()),
      refreshCatalog: () => tryPromise(() => refreshProviderCatalog()).pipe(Effect.asVoid),
      refreshCatalogForProvider: (providerID: string) =>
        tryPromise(() => refreshProviderCatalogForProvider(providerID)),
    }),
  );

  return Layer.mergeAll(
    ProvidersRepoLive,
    ModelsRepoLive,
    AuthRepoLive,
    PermissionsRepoLive,
    PendingRequestsRepoLive,
    MetaRepoLive,
    ModelExecutionRepoLive,
    CatalogRepoLive,
  );
}

import {
  AuthFlowExpiredError,
  PermissionDeniedError,
  type RuntimeRpcError,
  type RuntimeCreatePermissionRequestResponse,
  type RuntimeDismissPermissionRequestResponse,
  type RuntimeGenerateResponse,
  type RuntimeModelCallOptions,
  type RuntimeModelDescriptor,
  type RuntimePermissionDecision,
  type RuntimeRequestPermissionInput,
  type RuntimeResolvePermissionRequestResponse,
  type RuntimeStreamPart,
  RuntimeValidationError,
} from "@llm-bridge/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  AuthRepository,
  CatalogRepository,
  MetaRepository,
  ModelExecutionRepository,
  PermissionsRepository,
  type AuthRepositoryApi,
  type CatalogRepositoryApi,
  type MetaRepositoryApi,
  type ModelExecutionRepositoryApi,
  type PermissionsRepositoryApi,
} from "./repositories";

type AppEffect<A, E extends RuntimeRpcError = RuntimeRpcError> = Effect.Effect<
  A,
  E
>;

export function makeAuthFlowService(input: {
  auth: AuthRepositoryApi;
  catalog: CatalogRepositoryApi;
}) {
  const { auth, catalog } = input;

  return {
    openProviderAuthWindow: (providerID: string) =>
      auth.openProviderAuthWindow(providerID),
    getProviderAuthFlow: (providerID: string) =>
      auth.getProviderAuthFlow(providerID),
    startProviderAuthFlow: (request: {
      providerID: string;
      methodID: string;
      values?: Record<string, string>;
    }) =>
      auth.startProviderAuthFlow(request).pipe(
        Effect.tap(() =>
          catalog.refreshCatalogForProvider(request.providerID),
        ),
      ),
    cancelProviderAuthFlow: (request: {
      providerID: string;
      reason?: string;
    }) => auth.cancelProviderAuthFlow(request),
    disconnectProvider: (providerID: string) =>
      auth.disconnectProvider(providerID).pipe(
        Effect.tap(() => catalog.refreshCatalogForProvider(providerID)),
      ),
  };
}

export type AuthFlowServiceApi = ReturnType<typeof makeAuthFlowService>;

export class AuthFlowService extends Context.Tag(
  "@llm-bridge/runtime-core/AuthFlowService",
)<AuthFlowService, AuthFlowServiceApi>() {}

export const AuthFlowServiceLive = Layer.effect(
  AuthFlowService,
  Effect.gen(function* () {
    return makeAuthFlowService({
      auth: yield* AuthRepository,
      catalog: yield* CatalogRepository,
    });
  }),
);

export function makePermissionService(input: {
  permissions: PermissionsRepositoryApi;
  meta: MetaRepositoryApi;
}) {
  const { permissions, meta } = input;

  const ensureOriginEnabled = (origin: string): AppEffect<void> =>
    Effect.gen(function* () {
      const state = yield* permissions.getOriginState(origin);
      if (state.enabled) {
        return;
      }
      return yield* new RuntimeValidationError({
        message: `Origin ${origin} is disabled`,
      });
    });

  const ensureRequestAllowed = (
    origin: string,
    modelID: string,
    signal?: AbortSignal,
  ): AppEffect<void> =>
    Effect.gen(function* () {
      const permission = yield* permissions.getModelPermission(origin, modelID);
      if (permission === "allowed") {
        return;
      }

      const target = yield* meta.resolvePermissionTarget(modelID);
      const result = yield* permissions.createPermissionRequest({
        origin,
        modelId: target.modelId,
        provider: target.provider,
        modelName: target.modelName,
        capabilities: target.capabilities,
      });

      if (result.status === "alreadyAllowed") {
        return;
      }

      const waitResult = yield* permissions.waitForPermissionDecision(
        result.request.id,
        undefined,
        signal,
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

      const updated = yield* permissions.getModelPermission(origin, modelID);
      if (updated !== "allowed") {
        return yield* new PermissionDeniedError({
          origin,
          modelId: modelID,
          message: "Permission denied",
        });
      }
    });

  const requestPermission = (
    request: RuntimeRequestPermissionInput,
  ): AppEffect<
    | RuntimeCreatePermissionRequestResponse
    | RuntimeDismissPermissionRequestResponse
    | RuntimeResolvePermissionRequestResponse
  > =>
    Effect.gen(function* () {
      switch (request.action) {
        case "resolve":
          return yield* permissions.resolvePermissionRequest({
            requestId: request.requestId,
            decision: request.decision,
          });
        case "dismiss":
          return yield* permissions.dismissPermissionRequest(request.requestId);
        case "create": {
          const target = yield* meta.resolvePermissionTarget(request.modelId);
          return yield* permissions.createPermissionRequest({
            origin: request.origin,
            modelId: target.modelId,
            modelName: target.modelName,
            provider: target.provider,
            capabilities: target.capabilities,
          });
        }
      }
    });

  return {
    ensureOriginEnabled,
    ensureRequestAllowed,
    setOriginEnabled: (origin: string, enabled: boolean) =>
      permissions.setOriginEnabled(origin, enabled),
    updatePermission: (request: {
      origin: string;
      modelID: string;
      status: RuntimePermissionDecision;
      capabilities?: ReadonlyArray<string>;
    }) => permissions.updatePermission(request),
    requestPermission,
  };
}

export type PermissionServiceApi = ReturnType<typeof makePermissionService>;

export class PermissionService extends Context.Tag(
  "@llm-bridge/runtime-core/PermissionService",
)<PermissionService, PermissionServiceApi>() {}

export const PermissionServiceLive = Layer.effect(
  PermissionService,
  Effect.gen(function* () {
    return makePermissionService({
      permissions: yield* PermissionsRepository,
      meta: yield* MetaRepository,
    });
  }),
);

function withStreamCleanup<T>(
  stream: ReadableStream<T>,
  onFinalize: () => void,
): ReadableStream<T> {
  const reader = stream.getReader();

  return new ReadableStream<T>({
    async pull(controller) {
      const chunk = await reader.read();
      if (chunk.done) {
        onFinalize();
        controller.close();
        return;
      }
      controller.enqueue(chunk.value);
    },
    async cancel() {
      try {
        await reader.cancel();
      } finally {
        onFinalize();
      }
    },
  });
}

export function makeModelExecutionService(input: {
  models: ModelExecutionRepositoryApi;
  permissions: PermissionServiceApi;
}) {
  const { models, permissions } = input;
  const controllers = new Map<string, AbortController>();
  const pendingAbortKeys = new Set<string>();

  const toControllerKey = (request: {
    origin: string;
    sessionID: string;
    requestID: string;
  }) => `${request.origin}::${request.sessionID}::${request.requestID}`;

  const registerController = (request: {
    origin: string;
    sessionID: string;
    requestID: string;
  }) =>
    Effect.sync(() => {
      const key = toControllerKey(request);
      const controller = new AbortController();
      controllers.set(key, controller);
      if (pendingAbortKeys.delete(key)) {
        controller.abort();
      }
      return controller;
    });

  const unregisterController = (request: {
    origin: string;
    sessionID: string;
    requestID: string;
  }) =>
    Effect.sync(() => {
      const key = toControllerKey(request);
      controllers.delete(key);
      pendingAbortKeys.delete(key);
    });

  return {
    acquireModel: (request: {
      origin: string;
      sessionID: string;
      requestID: string;
      modelID: string;
    }): AppEffect<RuntimeModelDescriptor> =>
      Effect.gen(function* () {
        yield* permissions.ensureOriginEnabled(request.origin);
        yield* permissions.ensureRequestAllowed(request.origin, request.modelID);
        return yield* models.acquireModel(request);
      }),
    generateModel: (request: {
      origin: string;
      requestID: string;
      sessionID: string;
      modelID: string;
      options: RuntimeModelCallOptions;
    }): AppEffect<RuntimeGenerateResponse> =>
      Effect.gen(function* () {
        const controllerInput = {
          origin: request.origin,
          sessionID: request.sessionID,
          requestID: request.requestID,
        };

        return yield* Effect.gen(function* () {
          const controller = yield* registerController(controllerInput);
          yield* permissions.ensureOriginEnabled(request.origin);
          yield* permissions.ensureRequestAllowed(
            request.origin,
            request.modelID,
            controller.signal,
          );
          if (controller.signal.aborted) {
            return yield* new RuntimeValidationError({
              message: "Request canceled",
            });
          }
          return yield* models.generateModel({
            ...request,
            signal: controller.signal,
          });
        }).pipe(Effect.ensuring(unregisterController(controllerInput)));
      }),
    streamModel: (request: {
      origin: string;
      requestID: string;
      sessionID: string;
      modelID: string;
      options: RuntimeModelCallOptions;
    }): AppEffect<ReadableStream<RuntimeStreamPart>> =>
      Effect.gen(function* () {
        const controllerInput = {
          origin: request.origin,
          sessionID: request.sessionID,
          requestID: request.requestID,
        };

        const controller = yield* registerController(controllerInput);
        const stream = yield* Effect.gen(function* () {
          yield* permissions.ensureOriginEnabled(request.origin);
          yield* permissions.ensureRequestAllowed(
            request.origin,
            request.modelID,
            controller.signal,
          );
          if (controller.signal.aborted) {
            return yield* new RuntimeValidationError({
              message: "Request canceled",
            });
          }
          return yield* models.streamModel({
            ...request,
            signal: controller.signal,
          });
        }).pipe(Effect.tapError(() => unregisterController(controllerInput)));

        return withStreamCleanup(stream, () => {
          controller.abort();
          controllers.delete(toControllerKey(controllerInput));
          pendingAbortKeys.delete(toControllerKey(controllerInput));
        });
      }),
    abortModelCall: (request: {
      origin: string;
      sessionID: string;
      requestID: string;
    }): AppEffect<void> =>
      Effect.sync(() => {
        const key = toControllerKey(request);
        const controller = controllers.get(key);
        if (!controller) {
          pendingAbortKeys.add(key);
          return;
        }
        controller.abort();
        controllers.delete(key);
      }),
  };
}

export type ModelExecutionServiceApi = ReturnType<
  typeof makeModelExecutionService
>;

export class ModelExecutionService extends Context.Tag(
  "@llm-bridge/runtime-core/ModelExecutionService",
)<ModelExecutionService, ModelExecutionServiceApi>() {}

export const ModelExecutionServiceLive = Layer.effect(
  ModelExecutionService,
  Effect.gen(function* () {
    return makeModelExecutionService({
      models: yield* ModelExecutionRepository,
      permissions: yield* PermissionService,
    });
  }),
);

// @ts-expect-error bun:test types are not part of this package's TypeScript environment.
import { describe, expect, it } from "bun:test"
import { ModelNotFoundError } from "@llm-bridge/contracts"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import type {
  MetaRepositoryApi,
  PermissionsRepositoryApi,
  ResolvedPermissionTarget,
} from "./repositories"
import {
  MetaRepository,
  PermissionsRepository,
} from "./repositories"
import {
  PermissionService,
  PermissionServiceLive,
} from "./services"

const TEST_ORIGIN = "https://example.test"
const TEST_MODEL_ID = "openai/gpt-4o-mini"

const TRUSTED_TARGET: ResolvedPermissionTarget = {
  modelId: TEST_MODEL_ID,
  modelName: "GPT-4o mini",
  provider: "openai",
  capabilities: ["text", "code"],
}

async function createPermissionService(input?: {
  resolvePermissionTarget?: MetaRepositoryApi["resolvePermissionTarget"]
  getModelPermission?: PermissionsRepositoryApi["getModelPermission"]
  waitForPermissionDecision?: PermissionsRepositoryApi["waitForPermissionDecision"]
}) {
  const createdRequests: Array<{
    origin: string
    modelId: string
    modelName: string
    provider: string
    capabilities?: ReadonlyArray<string>
  }> = []
  const resolvedModels: string[] = []
  let permissionReads = 0

  const permissionsRepo = {
    getOriginState: (origin: string) =>
      Effect.succeed({
        origin,
        enabled: true,
      }),
    listPermissions: () => Effect.succeed([]),
    getModelPermission: input?.getModelPermission
      ?? ((_origin: string, _modelID: string) =>
        Effect.sync(() => {
          permissionReads += 1
          return permissionReads === 1 ? "denied" : "allowed"
        })),
    setOriginEnabled: (origin: string, enabled: boolean) =>
      Effect.succeed({
        origin,
        enabled,
      }),
    updatePermission: (payload: {
      origin: string
      modelID: string
      status: "allowed" | "denied"
      capabilities?: ReadonlyArray<string>
    }) =>
      Effect.succeed({
        origin: payload.origin,
        modelId: payload.modelID,
        status: payload.status,
      }),
    createPermissionRequest: (request) =>
      Effect.sync(() => {
        createdRequests.push(request)
        return {
          status: "requested" as const,
          request: {
            id: "prm_1",
            origin: request.origin,
            modelId: request.modelId,
            modelName: request.modelName,
            provider: request.provider,
            capabilities: [...(request.capabilities ?? [])],
            requestedAt: 1,
            dismissed: false,
            status: "pending" as const,
          },
        }
      }),
    resolvePermissionRequest: (payload: { requestId: string; decision: "allowed" | "denied" }) =>
      Effect.succeed({
        requestId: payload.requestId,
        decision: payload.decision,
      }),
    dismissPermissionRequest: (requestId: string) =>
      Effect.succeed({
        requestId,
      }),
    waitForPermissionDecision: input?.waitForPermissionDecision
      ?? (() => Effect.succeed("resolved" as const)),
  } satisfies PermissionsRepositoryApi

  const metaRepo = {
    parseProviderModel: (modelID: string) => ({
      providerID: modelID.split("/")[0] ?? "provider",
      modelID: modelID.split("/")[1] ?? modelID,
    }),
    resolvePermissionTarget: input?.resolvePermissionTarget
      ?? ((modelID: string) =>
        Effect.sync(() => {
          resolvedModels.push(modelID)
          return TRUSTED_TARGET
        })),
  } satisfies MetaRepositoryApi

  const layer = PermissionServiceLive.pipe(
    Layer.provideMerge(Layer.succeed(PermissionsRepository, permissionsRepo)),
    Layer.provideMerge(Layer.succeed(MetaRepository, metaRepo)),
  )

  const service = await Effect.runPromise(
    Effect.gen(function*() {
      return yield* PermissionService
    }).pipe(Effect.provide(layer)),
  )

  return {
    service,
    createdRequests,
    resolvedModels,
  }
}

describe("PermissionService trusted permission targets", () => {
  it("uses trusted metadata for explicit create requests", async () => {
    const { service, createdRequests, resolvedModels } = await createPermissionService()

    const result = await Effect.runPromise(
      service.requestPermission({
        origin: TEST_ORIGIN,
        action: "create",
        modelId: TEST_MODEL_ID,
      }),
    )

    expect("status" in result).toBe(true)
    if (!("status" in result)) {
      throw new Error("expected a create permission response")
    }
    expect(result.status).toBe("requested")
    expect(resolvedModels).toEqual([TEST_MODEL_ID])
    expect(createdRequests).toEqual([{
      origin: TEST_ORIGIN,
      modelId: TEST_MODEL_ID,
      modelName: TRUSTED_TARGET.modelName,
      provider: TRUSTED_TARGET.provider,
      capabilities: TRUSTED_TARGET.capabilities,
    }])
  })

  it("rejects unknown models before creating a permission request", async () => {
    const { service, createdRequests } = await createPermissionService({
      resolvePermissionTarget: (modelID: string) =>
        Effect.fail(new ModelNotFoundError({
          modelId: modelID,
          message: `Model ${modelID} was not found`,
        })),
    })

    await expect(
      Effect.runPromise(
        service.requestPermission({
          origin: TEST_ORIGIN,
          action: "create",
          modelId: "missing/model",
        }),
      ),
    ).rejects.toThrow(/Model missing\/model was not found/)

    expect(createdRequests).toEqual([])
  })

  it("uses the same trusted metadata for implicit permission prompts", async () => {
    const { service, createdRequests, resolvedModels } = await createPermissionService()

    await Effect.runPromise(service.ensureRequestAllowed(TEST_ORIGIN, TEST_MODEL_ID))

    expect(resolvedModels).toEqual([TEST_MODEL_ID])
    expect(createdRequests).toEqual([{
      origin: TEST_ORIGIN,
      modelId: TEST_MODEL_ID,
      modelName: TRUSTED_TARGET.modelName,
      provider: TRUSTED_TARGET.provider,
      capabilities: TRUSTED_TARGET.capabilities,
    }])
  })
})

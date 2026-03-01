import {
  createPermissionRequest,
  getModelPermission,
  getOriginPermissions,
  waitForPermissionDecision,
} from "@/lib/runtime/permissions"
import type {
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamPart,
} from "@ai-sdk/provider"
import {
  getRuntimeModelDescriptor,
  runLanguageModelGenerate,
  runLanguageModelStream,
  type RuntimeLanguageModelCallOptions,
} from "@/lib/runtime/ai/language-model-runtime"
import { parseProviderModel } from "@/lib/runtime/util"

async function ensureRequestAllowed(origin: string, model: string) {
  const permission = await getModelPermission(origin, model)
  if (permission === "allowed") return

  const parsed = parseProviderModel(model)
  const request = await createPermissionRequest({
    origin,
    modelId: model,
    provider: parsed.providerID,
    modelName: parsed.modelID,
  })
  const decision = await waitForPermissionDecision(request.id)
  if (decision === "timeout") {
    throw new Error("Permission request timed out")
  }
  const updated = await getModelPermission(origin, model)
  if (updated !== "allowed") {
    throw new Error("Permission denied")
  }
}

async function ensureOriginEnabled(origin: string) {
  const originPermissions = await getOriginPermissions(origin)
  if (!originPermissions.enabled) {
    throw new Error(`Origin ${origin} is disabled`)
  }
}

export interface AcquireRuntimeModelInput {
  origin: string
  sessionID: string
  requestID: string
  model: string
}

export interface GenerateRuntimeModelInput extends AcquireRuntimeModelInput {
  options: RuntimeLanguageModelCallOptions
}

export async function acquireRuntimeModel(input: AcquireRuntimeModelInput) {
  await ensureOriginEnabled(input.origin)
  await ensureRequestAllowed(input.origin, input.model)
  return getRuntimeModelDescriptor({
    modelID: input.model,
    origin: input.origin,
    sessionID: input.sessionID,
    requestID: input.requestID,
  })
}

export async function generateRuntimeModel(
  input: GenerateRuntimeModelInput,
  signal?: AbortSignal,
): Promise<LanguageModelV3GenerateResult> {
  await ensureOriginEnabled(input.origin)
  await ensureRequestAllowed(input.origin, input.model)

  return runLanguageModelGenerate(
    {
      modelID: input.model,
      origin: input.origin,
      sessionID: input.sessionID,
      requestID: input.requestID,
      options: input.options,
      signal,
    },
  )
}

export async function streamRuntimeModel(
  input: GenerateRuntimeModelInput,
  signal?: AbortSignal,
): Promise<ReadableStream<LanguageModelV3StreamPart>> {
  await ensureOriginEnabled(input.origin)
  await ensureRequestAllowed(input.origin, input.model)

  return runLanguageModelStream(
    {
      modelID: input.model,
      origin: input.origin,
      sessionID: input.sessionID,
      requestID: input.requestID,
      options: input.options,
      signal,
    },
  )
}

import {
  createPermissionRequest,
  getModelPermission,
  getOriginPermissions,
  waitForPermissionDecision,
} from "@/lib/runtime/permissions"
import { invokeGateway } from "@/lib/runtime/gateway/invoke"
import type { GatewayInvokeInput } from "@/lib/runtime/gateway/invoke"
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

export async function invokeRuntimeModel(input: GatewayInvokeInput, signal?: AbortSignal) {
  const originPermissions = await getOriginPermissions(input.origin)
  if (!originPermissions.enabled) {
    throw new Error(`Origin ${input.origin} is disabled`)
  }

  await ensureRequestAllowed(input.origin, input.model)
  return invokeGateway(input, signal)
}

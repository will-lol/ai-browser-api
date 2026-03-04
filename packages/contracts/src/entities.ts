import * as Schema from "effect/Schema"
import { JsonObjectSchema, type JsonValue } from "./json"

export const PermissionStatusSchema = Schema.Literal("allowed", "denied", "pending")
export type PermissionStatus = Schema.Schema.Type<typeof PermissionStatusSchema>

export const RuntimePermissionDecisionSchema = Schema.Literal("allowed", "denied")
export type RuntimePermissionDecision = Schema.Schema.Type<typeof RuntimePermissionDecisionSchema>

export const RuntimeProviderSummarySchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  connected: Schema.Boolean,
  env: Schema.Array(Schema.String),
  modelCount: Schema.Number,
})
export type RuntimeProviderSummary = Schema.Schema.Type<typeof RuntimeProviderSummarySchema>

export const RuntimeModelSummarySchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  provider: Schema.String,
  capabilities: Schema.Array(Schema.String),
  connected: Schema.Boolean,
})
export type RuntimeModelSummary = Schema.Schema.Type<typeof RuntimeModelSummarySchema>

export const RuntimeOriginStateSchema = Schema.Struct({
  origin: Schema.String,
  enabled: Schema.Boolean,
})
export type RuntimeOriginState = Schema.Schema.Type<typeof RuntimeOriginStateSchema>

export const RuntimePermissionEntrySchema = Schema.Struct({
  modelId: Schema.String,
  modelName: Schema.String,
  provider: Schema.String,
  status: PermissionStatusSchema,
  capabilities: Schema.Array(Schema.String),
  requestedAt: Schema.Number,
})
export type RuntimePermissionEntry = Schema.Schema.Type<typeof RuntimePermissionEntrySchema>

export const RuntimePendingRequestSchema = Schema.Struct({
  id: Schema.String,
  origin: Schema.String,
  modelId: Schema.String,
  modelName: Schema.String,
  provider: Schema.String,
  capabilities: Schema.Array(Schema.String),
  requestedAt: Schema.Number,
  dismissed: Schema.Boolean,
  status: Schema.Literal("pending", "resolved"),
})
export type RuntimePendingRequest = Schema.Schema.Type<typeof RuntimePendingRequestSchema>

const AuthFieldConditionSchema = Schema.Struct({
  key: Schema.String,
  equals: Schema.String,
})

const AuthFieldValidationSchema = Schema.Struct({
  regex: Schema.optional(Schema.String),
  message: Schema.optional(Schema.String),
  minLength: Schema.optional(Schema.Number),
  maxLength: Schema.optional(Schema.Number),
})

const AuthFieldOptionSchema = Schema.Struct({
  label: Schema.String,
  value: Schema.String,
  hint: Schema.optional(Schema.String),
})

const AuthFieldBaseFields = {
  key: Schema.String,
  label: Schema.String,
  placeholder: Schema.optional(Schema.String),
  defaultValue: Schema.optional(Schema.String),
  required: Schema.optional(Schema.Boolean),
  description: Schema.optional(Schema.String),
  condition: Schema.optional(AuthFieldConditionSchema),
  validate: Schema.optional(AuthFieldValidationSchema),
} as const

export const RuntimeAuthFieldSchema = Schema.Union(
  Schema.Struct({
    ...AuthFieldBaseFields,
    type: Schema.Literal("text", "secret"),
  }),
  Schema.Struct({
    ...AuthFieldBaseFields,
    type: Schema.Literal("select"),
    options: Schema.Array(AuthFieldOptionSchema),
  }),
)
export type RuntimeAuthField = Schema.Schema.Type<typeof RuntimeAuthFieldSchema>

export const RuntimeAuthMethodTypeSchema = Schema.Literal("oauth", "pat", "apikey")
export type RuntimeAuthMethodType = Schema.Schema.Type<typeof RuntimeAuthMethodTypeSchema>

export const RuntimeAuthMethodSchema = Schema.Struct({
  id: Schema.String,
  type: RuntimeAuthMethodTypeSchema,
  label: Schema.String,
  fields: Schema.optional(Schema.Array(RuntimeAuthFieldSchema)),
})
export type RuntimeAuthMethod = Schema.Schema.Type<typeof RuntimeAuthMethodSchema>

export const RuntimeAuthFlowStatusSchema = Schema.Literal(
  "idle",
  "authorizing",
  "success",
  "error",
  "canceled",
)
export type RuntimeAuthFlowStatus = Schema.Schema.Type<typeof RuntimeAuthFlowStatusSchema>

export const RuntimeAuthFlowSnapshotSchema = Schema.Struct({
  providerID: Schema.String,
  status: RuntimeAuthFlowStatusSchema,
  methods: Schema.Array(RuntimeAuthMethodSchema),
  runningMethodID: Schema.optional(Schema.String),
  error: Schema.optional(Schema.String),
  updatedAt: Schema.Number,
  canCancel: Schema.Boolean,
})
export type RuntimeAuthFlowSnapshot = Schema.Schema.Type<typeof RuntimeAuthFlowSnapshotSchema>

export const RuntimeOpenProviderAuthWindowResponseSchema = Schema.Struct({
  providerID: Schema.String,
  reused: Schema.Boolean,
  windowId: Schema.Number,
})
export type RuntimeOpenProviderAuthWindowResponse = Schema.Schema.Type<
  typeof RuntimeOpenProviderAuthWindowResponseSchema
>

export const RuntimeStartProviderAuthFlowResponseSchema = Schema.Struct({
  providerID: Schema.String,
  result: RuntimeAuthFlowSnapshotSchema,
})
export type RuntimeStartProviderAuthFlowResponse = Schema.Schema.Type<
  typeof RuntimeStartProviderAuthFlowResponseSchema
>

export const RuntimeCancelProviderAuthFlowResponseSchema = Schema.Struct({
  providerID: Schema.String,
  result: RuntimeAuthFlowSnapshotSchema,
})
export type RuntimeCancelProviderAuthFlowResponse = Schema.Schema.Type<
  typeof RuntimeCancelProviderAuthFlowResponseSchema
>

export const RuntimeDisconnectProviderResponseSchema = Schema.Struct({
  providerID: Schema.String,
  connected: Schema.Boolean,
})
export type RuntimeDisconnectProviderResponse = Schema.Schema.Type<
  typeof RuntimeDisconnectProviderResponseSchema
>

export const RuntimeSetOriginEnabledResponseSchema = RuntimeOriginStateSchema
export type RuntimeSetOriginEnabledResponse = Schema.Schema.Type<typeof RuntimeSetOriginEnabledResponseSchema>

export const RuntimeUpdatePermissionResponseSchema = Schema.Struct({
  origin: Schema.String,
  modelId: Schema.String,
  status: RuntimePermissionDecisionSchema,
})
export type RuntimeUpdatePermissionResponse = Schema.Schema.Type<
  typeof RuntimeUpdatePermissionResponseSchema
>

export const RuntimeCreatePermissionRequestResponseSchema = Schema.Union(
  Schema.Struct({
    status: Schema.Literal("alreadyAllowed"),
  }),
  Schema.Struct({
    status: Schema.Literal("requested"),
    request: RuntimePendingRequestSchema,
  }),
)
export type RuntimeCreatePermissionRequestResponse = Schema.Schema.Type<
  typeof RuntimeCreatePermissionRequestResponseSchema
>

export const RuntimeResolvePermissionRequestResponseSchema = Schema.Struct({
  requestId: Schema.String,
  decision: RuntimePermissionDecisionSchema,
})
export type RuntimeResolvePermissionRequestResponse = Schema.Schema.Type<
  typeof RuntimeResolvePermissionRequestResponseSchema
>

export const RuntimeDismissPermissionRequestResponseSchema = Schema.Struct({
  requestId: Schema.String,
})
export type RuntimeDismissPermissionRequestResponse = Schema.Schema.Type<
  typeof RuntimeDismissPermissionRequestResponseSchema
>

export const RuntimeUpdatePermissionInputSchema = Schema.Union(
  Schema.Struct({
    origin: Schema.String,
    mode: Schema.Literal("origin"),
    enabled: Schema.Boolean,
  }),
  Schema.Struct({
    origin: Schema.String,
    mode: Schema.Literal("model"),
    modelId: Schema.String,
    status: RuntimePermissionDecisionSchema,
    capabilities: Schema.optional(Schema.Array(Schema.String)),
  }),
)
export type RuntimeUpdatePermissionInput = Schema.Schema.Type<typeof RuntimeUpdatePermissionInputSchema>

export const RuntimeRequestPermissionInputSchema = Schema.Union(
  Schema.Struct({
    origin: Schema.String,
    action: Schema.Literal("resolve"),
    requestId: Schema.String,
    decision: RuntimePermissionDecisionSchema,
  }),
  Schema.Struct({
    origin: Schema.String,
    action: Schema.Literal("dismiss"),
    requestId: Schema.String,
  }),
  Schema.Struct({
    origin: Schema.String,
    action: Schema.Literal("create"),
    modelId: Schema.String,
    modelName: Schema.String,
    provider: Schema.String,
    capabilities: Schema.optional(Schema.Array(Schema.String)),
  }),
)
export type RuntimeRequestPermissionInput = Schema.Schema.Type<typeof RuntimeRequestPermissionInputSchema>

export const SerializedSupportedUrlPatternSchema = Schema.Struct({
  source: Schema.String,
  flags: Schema.optional(Schema.String),
})
export type SerializedSupportedUrlPattern = Schema.Schema.Type<typeof SerializedSupportedUrlPatternSchema>

export const RuntimeAcquireModelInputSchema = Schema.Struct({
  origin: Schema.String,
  requestId: Schema.String,
  sessionID: Schema.String,
  modelId: Schema.String,
})
export type RuntimeAcquireModelInput = Schema.Schema.Type<typeof RuntimeAcquireModelInputSchema>

export const RuntimeModelDescriptorSchema = Schema.Struct({
  specificationVersion: Schema.Literal("v3"),
  provider: Schema.String,
  modelId: Schema.String,
  supportedUrls: Schema.Record({
    key: Schema.String,
    value: Schema.Array(SerializedSupportedUrlPatternSchema),
  }),
})
export type RuntimeModelDescriptor = Schema.Schema.Type<typeof RuntimeModelDescriptorSchema>

export const RuntimeModelCallInputSchema = Schema.Struct({
  origin: Schema.String,
  requestId: Schema.String,
  sessionID: Schema.String,
  modelId: Schema.String,
  options: JsonObjectSchema,
})
export type RuntimeModelCallInput = Schema.Schema.Type<typeof RuntimeModelCallInputSchema>

export const RuntimeUsageSchema = Schema.Struct({
  inputTokens: Schema.Number,
  outputTokens: Schema.Number,
  totalTokens: Schema.Number,
})
export type RuntimeUsage = Schema.Schema.Type<typeof RuntimeUsageSchema>

export const RuntimeGenerateResponseSchema = Schema.Struct({
  requestId: Schema.String,
  modelId: Schema.String,
  text: Schema.String,
  finishReason: Schema.String,
  usage: RuntimeUsageSchema,
  providerMetadata: Schema.optional(JsonObjectSchema),
})
export type RuntimeGenerateResponse = Schema.Schema.Type<typeof RuntimeGenerateResponseSchema>

export const RuntimeStreamPartSchema = Schema.Union(
  Schema.Struct({
    type: Schema.Literal("text-delta"),
    delta: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("finish"),
    finishReason: Schema.String,
    usage: RuntimeUsageSchema,
  }),
  Schema.Struct({
    type: Schema.Literal("error"),
    message: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("other"),
    value: JsonObjectSchema,
  }),
)
export type RuntimeStreamPart = Schema.Schema.Type<typeof RuntimeStreamPartSchema>

export const RuntimeAbortModelCallInputSchema = Schema.Struct({
  requestId: Schema.String,
})
export type RuntimeAbortModelCallInput = Schema.Schema.Type<typeof RuntimeAbortModelCallInputSchema>

export const BridgePermissionRequestSchema = Schema.Struct({
  modelId: Schema.optional(Schema.String),
  modelName: Schema.optional(Schema.String),
  provider: Schema.optional(Schema.String),
  capabilities: Schema.optional(Schema.Array(Schema.String)),
})
export type BridgePermissionRequest = Schema.Schema.Type<typeof BridgePermissionRequestSchema>

export const BridgeModelRequestSchema = Schema.Struct({
  modelId: Schema.String,
  requestId: Schema.optional(Schema.String),
  sessionID: Schema.optional(Schema.String),
})
export type BridgeModelRequest = Schema.Schema.Type<typeof BridgeModelRequestSchema>

export const BridgeModelCallRequestSchema = Schema.Struct({
  requestId: Schema.optional(Schema.String),
  sessionID: Schema.optional(Schema.String),
  modelId: Schema.String,
  options: Schema.optional(JsonObjectSchema),
})
export type BridgeModelCallRequest = Schema.Schema.Type<typeof BridgeModelCallRequestSchema>

export const BridgeAbortRequestSchema = Schema.Struct({
  requestId: Schema.optional(Schema.String),
})
export type BridgeAbortRequest = Schema.Schema.Type<typeof BridgeAbortRequestSchema>

export const BridgeProviderStateSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  connected: Schema.Boolean,
  env: Schema.Array(Schema.String),
  authMethods: Schema.Array(RuntimeAuthMethodSchema),
  models: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      capabilities: Schema.Array(Schema.String),
    }),
  ),
})
export type BridgeProviderState = Schema.Schema.Type<typeof BridgeProviderStateSchema>

export const BridgeStateResponseSchema = Schema.Struct({
  providers: Schema.Array(BridgeProviderStateSchema),
  permissions: Schema.Array(RuntimePermissionEntrySchema),
  pendingRequests: Schema.Array(RuntimePendingRequestSchema),
  originEnabled: Schema.Boolean,
  currentOrigin: Schema.String,
})
export type BridgeStateResponse = Schema.Schema.Type<typeof BridgeStateResponseSchema>

export const BridgeListModelsResponseSchema = Schema.Struct({
  models: Schema.Array(RuntimeModelSummarySchema),
})
export type BridgeListModelsResponse = Schema.Schema.Type<typeof BridgeListModelsResponseSchema>

export const BridgeModelDescriptorResponseSchema = RuntimeModelDescriptorSchema
export type BridgeModelDescriptorResponse = Schema.Schema.Type<typeof BridgeModelDescriptorResponseSchema>

export function ensureJsonObject(value: JsonValue): { readonly [key: string]: JsonValue } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {}
  }
  return value as { readonly [key: string]: JsonValue }
}

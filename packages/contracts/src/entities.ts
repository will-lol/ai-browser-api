import * as Schema from "effect/Schema";
import { JsonObjectSchema, JsonValueSchema } from "./json";

export const PermissionStatusSchema = Schema.Literal(
  "allowed",
  "denied",
  "pending",
);
export type PermissionStatus = Schema.Schema.Type<
  typeof PermissionStatusSchema
>;

export const RuntimePermissionDecisionSchema = Schema.Literal(
  "allowed",
  "denied",
);
export type RuntimePermissionDecision = Schema.Schema.Type<
  typeof RuntimePermissionDecisionSchema
>;

export const RuntimeProviderSummarySchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  connected: Schema.Boolean,
  env: Schema.Array(Schema.String),
  modelCount: Schema.Number,
});
export type RuntimeProviderSummary = Schema.Schema.Type<
  typeof RuntimeProviderSummarySchema
>;

export const RuntimeModelSummarySchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  provider: Schema.String,
  capabilities: Schema.Array(Schema.String),
  connected: Schema.Boolean,
});
export type RuntimeModelSummary = Schema.Schema.Type<
  typeof RuntimeModelSummarySchema
>;

export const RuntimeOriginStateSchema = Schema.Struct({
  origin: Schema.String,
  enabled: Schema.Boolean,
});
export type RuntimeOriginState = Schema.Schema.Type<
  typeof RuntimeOriginStateSchema
>;

export const RuntimePermissionEntrySchema = Schema.Struct({
  modelId: Schema.String,
  modelName: Schema.String,
  provider: Schema.String,
  status: PermissionStatusSchema,
  capabilities: Schema.Array(Schema.String),
  requestedAt: Schema.Number,
});
export type RuntimePermissionEntry = Schema.Schema.Type<
  typeof RuntimePermissionEntrySchema
>;

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
});
export type RuntimePendingRequest = Schema.Schema.Type<
  typeof RuntimePendingRequestSchema
>;

export const RuntimeAuthMethodTypeSchema = Schema.Literal(
  "oauth",
  "pat",
  "apikey",
);
export type RuntimeAuthMethodType = Schema.Schema.Type<
  typeof RuntimeAuthMethodTypeSchema
>;

export const RuntimeAuthMethodSchema = Schema.Struct({
  id: Schema.String,
  type: RuntimeAuthMethodTypeSchema,
  label: Schema.String,
});
export type RuntimeAuthMethod = Schema.Schema.Type<
  typeof RuntimeAuthMethodSchema
>;

export const RuntimeAuthFlowStatusSchema = Schema.Literal(
  "idle",
  "authorizing",
  "success",
  "error",
  "canceled",
);
export type RuntimeAuthFlowStatus = Schema.Schema.Type<
  typeof RuntimeAuthFlowStatusSchema
>;

export const RuntimeAuthFlowInstructionSchema = Schema.Struct({
  kind: Schema.Literal("device_code", "notice"),
  title: Schema.String,
  message: Schema.optional(Schema.String),
  code: Schema.optional(Schema.String),
  url: Schema.optional(Schema.String),
  autoOpened: Schema.optional(Schema.Boolean),
});
export type RuntimeAuthFlowInstruction = Schema.Schema.Type<
  typeof RuntimeAuthFlowInstructionSchema
>;

export const RuntimeAuthFlowSnapshotSchema = Schema.Struct({
  providerID: Schema.String,
  status: RuntimeAuthFlowStatusSchema,
  methods: Schema.Array(RuntimeAuthMethodSchema),
  runningMethodID: Schema.optional(Schema.String),
  instruction: Schema.optional(RuntimeAuthFlowInstructionSchema),
  error: Schema.optional(Schema.String),
  updatedAt: Schema.Number,
  canCancel: Schema.Boolean,
});
export type RuntimeAuthFlowSnapshot = Schema.Schema.Type<
  typeof RuntimeAuthFlowSnapshotSchema
>;

export const RuntimeOpenProviderAuthWindowResponseSchema = Schema.Struct({
  providerID: Schema.String,
  reused: Schema.Boolean,
  windowId: Schema.Number,
});
export type RuntimeOpenProviderAuthWindowResponse = Schema.Schema.Type<
  typeof RuntimeOpenProviderAuthWindowResponseSchema
>;

export const RuntimeStartProviderAuthFlowResponseSchema = Schema.Struct({
  providerID: Schema.String,
  result: RuntimeAuthFlowSnapshotSchema,
});
export type RuntimeStartProviderAuthFlowResponse = Schema.Schema.Type<
  typeof RuntimeStartProviderAuthFlowResponseSchema
>;

export const RuntimeCancelProviderAuthFlowResponseSchema = Schema.Struct({
  providerID: Schema.String,
  result: RuntimeAuthFlowSnapshotSchema,
});
export type RuntimeCancelProviderAuthFlowResponse = Schema.Schema.Type<
  typeof RuntimeCancelProviderAuthFlowResponseSchema
>;

export const RuntimeDisconnectProviderResponseSchema = Schema.Struct({
  providerID: Schema.String,
  connected: Schema.Boolean,
});
export type RuntimeDisconnectProviderResponse = Schema.Schema.Type<
  typeof RuntimeDisconnectProviderResponseSchema
>;

export const RuntimeSetOriginEnabledResponseSchema = RuntimeOriginStateSchema;
export type RuntimeSetOriginEnabledResponse = Schema.Schema.Type<
  typeof RuntimeSetOriginEnabledResponseSchema
>;

export const RuntimeUpdatePermissionResponseSchema = Schema.Struct({
  origin: Schema.String,
  modelId: Schema.String,
  status: RuntimePermissionDecisionSchema,
});
export type RuntimeUpdatePermissionResponse = Schema.Schema.Type<
  typeof RuntimeUpdatePermissionResponseSchema
>;

export const RuntimeCreatePermissionRequestResponseSchema = Schema.Union(
  Schema.Struct({
    status: Schema.Literal("alreadyAllowed"),
  }),
  Schema.Struct({
    status: Schema.Literal("requested"),
    request: RuntimePendingRequestSchema,
  }),
);
export type RuntimeCreatePermissionRequestResponse = Schema.Schema.Type<
  typeof RuntimeCreatePermissionRequestResponseSchema
>;

export const RuntimeResolvePermissionRequestResponseSchema = Schema.Struct({
  requestId: Schema.String,
  decision: RuntimePermissionDecisionSchema,
});
export type RuntimeResolvePermissionRequestResponse = Schema.Schema.Type<
  typeof RuntimeResolvePermissionRequestResponseSchema
>;

export const RuntimeDismissPermissionRequestResponseSchema = Schema.Struct({
  requestId: Schema.String,
});
export type RuntimeDismissPermissionRequestResponse = Schema.Schema.Type<
  typeof RuntimeDismissPermissionRequestResponseSchema
>;

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
);
export type RuntimeUpdatePermissionInput = Schema.Schema.Type<
  typeof RuntimeUpdatePermissionInputSchema
>;

export const RuntimeRequestPermissionInputSchema = Schema.Union(
  Schema.Struct({
    origin: Schema.String,
    action: Schema.Literal("create"),
    modelId: Schema.String,
  }),
  Schema.Struct({
    action: Schema.Literal("resolve"),
    requestId: Schema.String,
    decision: RuntimePermissionDecisionSchema,
  }),
  Schema.Struct({
    action: Schema.Literal("dismiss"),
    requestId: Schema.String,
  }),
);
export type RuntimeRequestPermissionInput = Schema.Schema.Type<
  typeof RuntimeRequestPermissionInputSchema
>;

export const RuntimeCreatePermissionRequestInputSchema = Schema.Struct({
  origin: Schema.String,
  action: Schema.Literal("create"),
  modelId: Schema.String,
});
export type RuntimeCreatePermissionRequestInput = Schema.Schema.Type<
  typeof RuntimeCreatePermissionRequestInputSchema
>;

export const SerializedSupportedUrlPatternSchema = Schema.Struct({
  source: Schema.String,
  flags: Schema.optional(Schema.String),
});
export type SerializedSupportedUrlPattern = Schema.Schema.Type<
  typeof SerializedSupportedUrlPatternSchema
>;

const WIRE_TYPE_KEY = "__llmBridgeWireType";

export const RuntimeWireUndefinedSchema = Schema.Struct({
  [WIRE_TYPE_KEY]: Schema.Literal("undefined"),
});
export type RuntimeWireUndefined = Schema.Schema.Type<
  typeof RuntimeWireUndefinedSchema
>;

export const RuntimeWireUrlSchema = Schema.Struct({
  [WIRE_TYPE_KEY]: Schema.Literal("url"),
  href: Schema.String,
});
export type RuntimeWireUrl = Schema.Schema.Type<typeof RuntimeWireUrlSchema>;

export const RuntimeWireUint8ArraySchema = Schema.Struct({
  [WIRE_TYPE_KEY]: Schema.Literal("uint8array"),
  base64: Schema.String,
});
export type RuntimeWireUint8Array = Schema.Schema.Type<
  typeof RuntimeWireUint8ArraySchema
>;

export const RuntimeWireDateSchema = Schema.Struct({
  [WIRE_TYPE_KEY]: Schema.Literal("date"),
  iso: Schema.String,
});
export type RuntimeWireDate = Schema.Schema.Type<typeof RuntimeWireDateSchema>;

export const RuntimeWireErrorSchema = Schema.Struct({
  [WIRE_TYPE_KEY]: Schema.Literal("error"),
  name: Schema.String,
  message: Schema.String,
  stack: Schema.optional(Schema.String),
});
export type RuntimeWireError = Schema.Schema.Type<
  typeof RuntimeWireErrorSchema
>;

export type RuntimeWireValue =
  | null
  | string
  | number
  | boolean
  | RuntimeWireUndefined
  | RuntimeWireUrl
  | RuntimeWireUint8Array
  | RuntimeWireDate
  | RuntimeWireError
  | ReadonlyArray<RuntimeWireValue>
  | { readonly [key: string]: RuntimeWireValue };

export const RuntimeWireValueSchema: Schema.Schema<RuntimeWireValue> =
  Schema.suspend(() =>
    Schema.Union(
      Schema.Null,
      Schema.String,
      Schema.Number,
      Schema.Boolean,
      RuntimeWireUndefinedSchema,
      RuntimeWireUrlSchema,
      RuntimeWireUint8ArraySchema,
      RuntimeWireDateSchema,
      RuntimeWireErrorSchema,
      Schema.Array(RuntimeWireValueSchema),
      Schema.Record({
        key: Schema.String,
        value: RuntimeWireValueSchema,
      }),
    ),
  );

export const RuntimeProviderOptionsSchema = Schema.Record({
  key: Schema.String,
  value: JsonObjectSchema,
});
export type RuntimeProviderOptions = Schema.Schema.Type<
  typeof RuntimeProviderOptionsSchema
>;

export const RuntimeProviderMetadataSchema = RuntimeProviderOptionsSchema;
export type RuntimeProviderMetadata = Schema.Schema.Type<
  typeof RuntimeProviderMetadataSchema
>;

export const RuntimeWarningSchema = Schema.Union(
  Schema.Struct({
    type: Schema.Literal("unsupported", "compatibility"),
    feature: Schema.String,
    details: Schema.optional(Schema.String),
  }),
  Schema.Struct({
    type: Schema.Literal("other"),
    message: Schema.String,
  }),
);
export type RuntimeWarning = Schema.Schema.Type<typeof RuntimeWarningSchema>;

const RuntimePromptTextPartSchema = Schema.Struct({
  type: Schema.Literal("text"),
  text: Schema.String,
  providerOptions: Schema.optional(RuntimeProviderOptionsSchema),
});

const RuntimePromptReasoningPartSchema = Schema.Struct({
  type: Schema.Literal("reasoning"),
  text: Schema.String,
  providerOptions: Schema.optional(RuntimeProviderOptionsSchema),
});

const RuntimePromptFilePartSchema = Schema.Struct({
  type: Schema.Literal("file"),
  filename: Schema.optional(Schema.String),
  data: Schema.Union(
    Schema.String,
    RuntimeWireUrlSchema,
    RuntimeWireUint8ArraySchema,
  ),
  mediaType: Schema.String,
  providerOptions: Schema.optional(RuntimeProviderOptionsSchema),
});

const RuntimePromptToolResultContentPartSchema = Schema.Union(
  Schema.Struct({
    type: Schema.Literal("text"),
    text: Schema.String,
    providerOptions: Schema.optional(RuntimeProviderOptionsSchema),
  }),
  Schema.Struct({
    type: Schema.Literal("file-data"),
    data: Schema.String,
    mediaType: Schema.String,
    filename: Schema.optional(Schema.String),
    providerOptions: Schema.optional(RuntimeProviderOptionsSchema),
  }),
  Schema.Struct({
    type: Schema.Literal("file-url"),
    url: Schema.String,
    providerOptions: Schema.optional(RuntimeProviderOptionsSchema),
  }),
  Schema.Struct({
    type: Schema.Literal("file-id"),
    fileId: Schema.Union(
      Schema.String,
      Schema.Record({
        key: Schema.String,
        value: Schema.String,
      }),
    ),
    providerOptions: Schema.optional(RuntimeProviderOptionsSchema),
  }),
  Schema.Struct({
    type: Schema.Literal("image-data"),
    data: Schema.String,
    mediaType: Schema.String,
    providerOptions: Schema.optional(RuntimeProviderOptionsSchema),
  }),
  Schema.Struct({
    type: Schema.Literal("image-url"),
    url: Schema.String,
    providerOptions: Schema.optional(RuntimeProviderOptionsSchema),
  }),
  Schema.Struct({
    type: Schema.Literal("image-file-id"),
    fileId: Schema.Union(
      Schema.String,
      Schema.Record({
        key: Schema.String,
        value: Schema.String,
      }),
    ),
    providerOptions: Schema.optional(RuntimeProviderOptionsSchema),
  }),
  Schema.Struct({
    type: Schema.Literal("custom"),
    providerOptions: Schema.optional(RuntimeProviderOptionsSchema),
  }),
);

const RuntimePromptToolResultOutputSchema = Schema.Union(
  Schema.Struct({
    type: Schema.Literal("text"),
    value: Schema.String,
    providerOptions: Schema.optional(RuntimeProviderOptionsSchema),
  }),
  Schema.Struct({
    type: Schema.Literal("json"),
    value: JsonValueSchema,
    providerOptions: Schema.optional(RuntimeProviderOptionsSchema),
  }),
  Schema.Struct({
    type: Schema.Literal("execution-denied"),
    reason: Schema.optional(Schema.String),
    providerOptions: Schema.optional(RuntimeProviderOptionsSchema),
  }),
  Schema.Struct({
    type: Schema.Literal("error-text"),
    value: Schema.String,
    providerOptions: Schema.optional(RuntimeProviderOptionsSchema),
  }),
  Schema.Struct({
    type: Schema.Literal("error-json"),
    value: JsonValueSchema,
    providerOptions: Schema.optional(RuntimeProviderOptionsSchema),
  }),
  Schema.Struct({
    type: Schema.Literal("content"),
    value: Schema.Array(RuntimePromptToolResultContentPartSchema),
    providerOptions: Schema.optional(RuntimeProviderOptionsSchema),
  }),
);

const RuntimePromptToolCallPartSchema = Schema.Struct({
  type: Schema.Literal("tool-call"),
  toolCallId: Schema.String,
  toolName: Schema.String,
  input: RuntimeWireValueSchema,
  providerExecuted: Schema.optional(Schema.Boolean),
  providerOptions: Schema.optional(RuntimeProviderOptionsSchema),
});

const RuntimePromptToolResultPartSchema = Schema.Struct({
  type: Schema.Literal("tool-result"),
  toolCallId: Schema.String,
  toolName: Schema.String,
  output: RuntimePromptToolResultOutputSchema,
  providerOptions: Schema.optional(RuntimeProviderOptionsSchema),
});

const RuntimePromptToolApprovalResponsePartSchema = Schema.Struct({
  type: Schema.Literal("tool-approval-response"),
  approvalId: Schema.String,
  approved: Schema.Boolean,
  reason: Schema.optional(Schema.String),
  providerOptions: Schema.optional(RuntimeProviderOptionsSchema),
});

const RuntimePromptSystemMessageSchema = Schema.Struct({
  role: Schema.Literal("system"),
  content: Schema.String,
  providerOptions: Schema.optional(RuntimeProviderOptionsSchema),
});

const RuntimePromptUserMessageSchema = Schema.Struct({
  role: Schema.Literal("user"),
  content: Schema.Array(
    Schema.Union(RuntimePromptTextPartSchema, RuntimePromptFilePartSchema),
  ),
  providerOptions: Schema.optional(RuntimeProviderOptionsSchema),
});

const RuntimePromptAssistantMessageSchema = Schema.Struct({
  role: Schema.Literal("assistant"),
  content: Schema.Array(
    Schema.Union(
      RuntimePromptTextPartSchema,
      RuntimePromptFilePartSchema,
      RuntimePromptReasoningPartSchema,
      RuntimePromptToolCallPartSchema,
      RuntimePromptToolResultPartSchema,
    ),
  ),
  providerOptions: Schema.optional(RuntimeProviderOptionsSchema),
});

const RuntimePromptToolMessageSchema = Schema.Struct({
  role: Schema.Literal("tool"),
  content: Schema.Array(
    Schema.Union(
      RuntimePromptToolResultPartSchema,
      RuntimePromptToolApprovalResponsePartSchema,
    ),
  ),
  providerOptions: Schema.optional(RuntimeProviderOptionsSchema),
});

export const RuntimePromptMessageSchema = Schema.Union(
  RuntimePromptSystemMessageSchema,
  RuntimePromptUserMessageSchema,
  RuntimePromptAssistantMessageSchema,
  RuntimePromptToolMessageSchema,
);
export type RuntimePromptMessage = Schema.Schema.Type<
  typeof RuntimePromptMessageSchema
>;

const RuntimeFunctionToolSchema = Schema.Struct({
  type: Schema.Literal("function"),
  name: Schema.String,
  description: Schema.optional(Schema.String),
  inputSchema: RuntimeWireValueSchema,
  inputExamples: Schema.optional(
    Schema.Array(
      Schema.Struct({
        input: JsonObjectSchema,
      }),
    ),
  ),
  strict: Schema.optional(Schema.Boolean),
  providerOptions: Schema.optional(RuntimeProviderOptionsSchema),
});

const RuntimeProviderToolSchema = Schema.Struct({
  type: Schema.Literal("provider"),
  id: Schema.String,
  name: Schema.String,
  args: Schema.Record({
    key: Schema.String,
    value: RuntimeWireValueSchema,
  }),
});

export const RuntimeToolSchema = Schema.Union(
  RuntimeFunctionToolSchema,
  RuntimeProviderToolSchema,
);
export type RuntimeTool = Schema.Schema.Type<typeof RuntimeToolSchema>;

export const RuntimeToolChoiceSchema = Schema.Union(
  Schema.Struct({
    type: Schema.Literal("auto", "none", "required"),
  }),
  Schema.Struct({
    type: Schema.Literal("tool"),
    toolName: Schema.String,
  }),
);
export type RuntimeToolChoice = Schema.Schema.Type<
  typeof RuntimeToolChoiceSchema
>;

export const RuntimeResponseFormatSchema = Schema.Union(
  Schema.Struct({
    type: Schema.Literal("text"),
  }),
  Schema.Struct({
    type: Schema.Literal("json"),
    schema: Schema.optional(RuntimeWireValueSchema),
    name: Schema.optional(Schema.String),
    description: Schema.optional(Schema.String),
  }),
);
export type RuntimeResponseFormat = Schema.Schema.Type<
  typeof RuntimeResponseFormatSchema
>;

export const RuntimeModelCallOptionsSchema = Schema.Struct({
  prompt: Schema.Array(RuntimePromptMessageSchema),
  maxOutputTokens: Schema.optional(Schema.Number),
  temperature: Schema.optional(Schema.Number),
  stopSequences: Schema.optional(Schema.Array(Schema.String)),
  topP: Schema.optional(Schema.Number),
  topK: Schema.optional(Schema.Number),
  presencePenalty: Schema.optional(Schema.Number),
  frequencyPenalty: Schema.optional(Schema.Number),
  responseFormat: Schema.optional(RuntimeResponseFormatSchema),
  seed: Schema.optional(Schema.Number),
  tools: Schema.optional(Schema.Array(RuntimeToolSchema)),
  toolChoice: Schema.optional(RuntimeToolChoiceSchema),
  includeRawChunks: Schema.optional(Schema.Boolean),
  headers: Schema.optional(
    Schema.Record({
      key: Schema.String,
      value: Schema.String,
    }),
  ),
  providerOptions: Schema.optional(RuntimeProviderOptionsSchema),
});
export type RuntimeModelCallOptions = Schema.Schema.Type<
  typeof RuntimeModelCallOptionsSchema
>;

export const RuntimeChatMessageSchema = JsonObjectSchema;
export type RuntimeChatMessage = Schema.Schema.Type<
  typeof RuntimeChatMessageSchema
>;

export const RuntimeChatStreamChunkSchema = JsonObjectSchema;
export type RuntimeChatStreamChunk = Schema.Schema.Type<
  typeof RuntimeChatStreamChunkSchema
>;

export const RuntimeChatSendTriggerSchema = Schema.Literal(
  "submit-message",
  "regenerate-message",
);
export type RuntimeChatSendTrigger = Schema.Schema.Type<
  typeof RuntimeChatSendTriggerSchema
>;

export const RuntimeChatCallOptionsSchema = Schema.Struct({
  system: Schema.optional(Schema.String),
  maxOutputTokens: Schema.optional(Schema.Number),
  temperature: Schema.optional(Schema.Number),
  stopSequences: Schema.optional(Schema.Array(Schema.String)),
  topP: Schema.optional(Schema.Number),
  topK: Schema.optional(Schema.Number),
  presencePenalty: Schema.optional(Schema.Number),
  frequencyPenalty: Schema.optional(Schema.Number),
  responseFormat: Schema.optional(RuntimeResponseFormatSchema),
  seed: Schema.optional(Schema.Number),
  tools: Schema.optional(Schema.Array(RuntimeToolSchema)),
  toolChoice: Schema.optional(RuntimeToolChoiceSchema),
  includeRawChunks: Schema.optional(Schema.Boolean),
  headers: Schema.optional(
    Schema.Record({
      key: Schema.String,
      value: Schema.String,
    }),
  ),
  providerOptions: Schema.optional(RuntimeProviderOptionsSchema),
});
export type RuntimeChatCallOptions = Schema.Schema.Type<
  typeof RuntimeChatCallOptionsSchema
>;

export const RuntimeAcquireModelInputSchema = Schema.Struct({
  origin: Schema.String,
  requestId: Schema.String,
  sessionID: Schema.String,
  modelId: Schema.String,
});
export type RuntimeAcquireModelInput = Schema.Schema.Type<
  typeof RuntimeAcquireModelInputSchema
>;

export const RuntimeModelDescriptorSchema = Schema.Struct({
  specificationVersion: Schema.Literal("v3"),
  provider: Schema.String,
  modelId: Schema.String,
  supportedUrls: Schema.Record({
    key: Schema.String,
    value: Schema.Array(SerializedSupportedUrlPatternSchema),
  }),
});
export type RuntimeModelDescriptor = Schema.Schema.Type<
  typeof RuntimeModelDescriptorSchema
>;

export const RuntimeModelCallInputSchema = Schema.Struct({
  origin: Schema.String,
  requestId: Schema.String,
  sessionID: Schema.String,
  modelId: Schema.String,
  options: RuntimeModelCallOptionsSchema,
});
export type RuntimeModelCallInput = Schema.Schema.Type<
  typeof RuntimeModelCallInputSchema
>;

export const RuntimeFinishReasonSchema = Schema.Struct({
  unified: Schema.Literal(
    "stop",
    "length",
    "content-filter",
    "tool-calls",
    "error",
    "other",
  ),
  raw: Schema.optional(Schema.String),
});
export type RuntimeFinishReason = Schema.Schema.Type<
  typeof RuntimeFinishReasonSchema
>;

const RuntimeResponseMetadataBaseSchema = Schema.Struct({
  id: Schema.optional(Schema.String),
  timestamp: Schema.optional(RuntimeWireDateSchema),
  modelId: Schema.optional(Schema.String),
});

export const RuntimeUsageSchema = Schema.Struct({
  inputTokens: Schema.Struct({
    total: Schema.optional(Schema.Number),
    noCache: Schema.optional(Schema.Number),
    cacheRead: Schema.optional(Schema.Number),
    cacheWrite: Schema.optional(Schema.Number),
  }),
  outputTokens: Schema.Struct({
    total: Schema.optional(Schema.Number),
    text: Schema.optional(Schema.Number),
    reasoning: Schema.optional(Schema.Number),
  }),
  raw: Schema.optional(JsonObjectSchema),
});
export type RuntimeUsage = Schema.Schema.Type<typeof RuntimeUsageSchema>;

const RuntimeGeneratedTextSchema = Schema.Struct({
  type: Schema.Literal("text"),
  text: Schema.String,
  providerMetadata: Schema.optional(RuntimeProviderMetadataSchema),
});

const RuntimeGeneratedReasoningSchema = Schema.Struct({
  type: Schema.Literal("reasoning"),
  text: Schema.String,
  providerMetadata: Schema.optional(RuntimeProviderMetadataSchema),
});

const RuntimeGeneratedFileSchema = Schema.Struct({
  type: Schema.Literal("file"),
  mediaType: Schema.String,
  data: Schema.Union(Schema.String, RuntimeWireUint8ArraySchema),
  providerMetadata: Schema.optional(RuntimeProviderMetadataSchema),
});

const RuntimeGeneratedToolApprovalRequestSchema = Schema.Struct({
  type: Schema.Literal("tool-approval-request"),
  approvalId: Schema.String,
  toolCallId: Schema.String,
  providerMetadata: Schema.optional(RuntimeProviderMetadataSchema),
});

const RuntimeGeneratedSourceSchema = Schema.Union(
  Schema.Struct({
    type: Schema.Literal("source"),
    sourceType: Schema.Literal("url"),
    id: Schema.String,
    url: Schema.String,
    title: Schema.optional(Schema.String),
    providerMetadata: Schema.optional(RuntimeProviderMetadataSchema),
  }),
  Schema.Struct({
    type: Schema.Literal("source"),
    sourceType: Schema.Literal("document"),
    id: Schema.String,
    mediaType: Schema.String,
    title: Schema.String,
    filename: Schema.optional(Schema.String),
    providerMetadata: Schema.optional(RuntimeProviderMetadataSchema),
  }),
);

const RuntimeGeneratedToolCallSchema = Schema.Struct({
  type: Schema.Literal("tool-call"),
  toolCallId: Schema.String,
  toolName: Schema.String,
  input: Schema.String,
  providerExecuted: Schema.optional(Schema.Boolean),
  dynamic: Schema.optional(Schema.Boolean),
  providerMetadata: Schema.optional(RuntimeProviderMetadataSchema),
});

const RuntimeGeneratedToolResultSchema = Schema.Struct({
  type: Schema.Literal("tool-result"),
  toolCallId: Schema.String,
  toolName: Schema.String,
  result: JsonValueSchema,
  isError: Schema.optional(Schema.Boolean),
  preliminary: Schema.optional(Schema.Boolean),
  dynamic: Schema.optional(Schema.Boolean),
  providerMetadata: Schema.optional(RuntimeProviderMetadataSchema),
});

export const RuntimeGeneratedContentSchema = Schema.Union(
  RuntimeGeneratedTextSchema,
  RuntimeGeneratedReasoningSchema,
  RuntimeGeneratedFileSchema,
  RuntimeGeneratedToolApprovalRequestSchema,
  RuntimeGeneratedSourceSchema,
  RuntimeGeneratedToolCallSchema,
  RuntimeGeneratedToolResultSchema,
);
export type RuntimeGeneratedContent = Schema.Schema.Type<
  typeof RuntimeGeneratedContentSchema
>;

export const RuntimeGenerateResponseSchema = Schema.Struct({
  content: Schema.Array(RuntimeGeneratedContentSchema),
  finishReason: RuntimeFinishReasonSchema,
  usage: RuntimeUsageSchema,
  providerMetadata: Schema.optional(RuntimeProviderMetadataSchema),
  request: Schema.optional(
    Schema.Struct({
      body: Schema.optional(RuntimeWireValueSchema),
    }),
  ),
  response: Schema.optional(
    Schema.Struct({
      ...RuntimeResponseMetadataBaseSchema.fields,
      headers: Schema.optional(
        Schema.Record({
          key: Schema.String,
          value: Schema.String,
        }),
      ),
      body: Schema.optional(RuntimeWireValueSchema),
    }),
  ),
  warnings: Schema.Array(RuntimeWarningSchema),
});
export type RuntimeGenerateResponse = Schema.Schema.Type<
  typeof RuntimeGenerateResponseSchema
>;

export const RuntimeStreamPartSchema = Schema.Union(
  Schema.Struct({
    type: Schema.Literal("text-start"),
    id: Schema.String,
    providerMetadata: Schema.optional(RuntimeProviderMetadataSchema),
  }),
  Schema.Struct({
    type: Schema.Literal("text-delta"),
    id: Schema.String,
    delta: Schema.String,
    providerMetadata: Schema.optional(RuntimeProviderMetadataSchema),
  }),
  Schema.Struct({
    type: Schema.Literal("text-end"),
    id: Schema.String,
    providerMetadata: Schema.optional(RuntimeProviderMetadataSchema),
  }),
  Schema.Struct({
    type: Schema.Literal("reasoning-start"),
    id: Schema.String,
    providerMetadata: Schema.optional(RuntimeProviderMetadataSchema),
  }),
  Schema.Struct({
    type: Schema.Literal("reasoning-delta"),
    id: Schema.String,
    delta: Schema.String,
    providerMetadata: Schema.optional(RuntimeProviderMetadataSchema),
  }),
  Schema.Struct({
    type: Schema.Literal("reasoning-end"),
    id: Schema.String,
    providerMetadata: Schema.optional(RuntimeProviderMetadataSchema),
  }),
  Schema.Struct({
    type: Schema.Literal("tool-input-start"),
    id: Schema.String,
    toolName: Schema.String,
    providerMetadata: Schema.optional(RuntimeProviderMetadataSchema),
    providerExecuted: Schema.optional(Schema.Boolean),
    dynamic: Schema.optional(Schema.Boolean),
    title: Schema.optional(Schema.String),
  }),
  Schema.Struct({
    type: Schema.Literal("tool-input-delta"),
    id: Schema.String,
    delta: Schema.String,
    providerMetadata: Schema.optional(RuntimeProviderMetadataSchema),
  }),
  Schema.Struct({
    type: Schema.Literal("tool-input-end"),
    id: Schema.String,
    providerMetadata: Schema.optional(RuntimeProviderMetadataSchema),
  }),
  RuntimeGeneratedToolApprovalRequestSchema,
  RuntimeGeneratedToolCallSchema,
  RuntimeGeneratedToolResultSchema,
  RuntimeGeneratedFileSchema,
  RuntimeGeneratedSourceSchema,
  Schema.Struct({
    type: Schema.Literal("stream-start"),
    warnings: Schema.Array(RuntimeWarningSchema),
  }),
  Schema.Struct({
    type: Schema.Literal("response-metadata"),
    ...RuntimeResponseMetadataBaseSchema.fields,
  }),
  Schema.Struct({
    type: Schema.Literal("finish"),
    finishReason: RuntimeFinishReasonSchema,
    usage: RuntimeUsageSchema,
    providerMetadata: Schema.optional(RuntimeProviderMetadataSchema),
  }),
  Schema.Struct({
    type: Schema.Literal("error"),
    error: RuntimeWireValueSchema,
  }),
  Schema.Struct({
    type: Schema.Literal("raw"),
    rawValue: RuntimeWireValueSchema,
  }),
);
export type RuntimeStreamPart = Schema.Schema.Type<
  typeof RuntimeStreamPartSchema
>;

export const RuntimeAbortModelCallInputSchema = Schema.Struct({
  origin: Schema.String,
  sessionID: Schema.String,
  requestId: Schema.String,
});
export type RuntimeAbortModelCallInput = Schema.Schema.Type<
  typeof RuntimeAbortModelCallInputSchema
>;

export const BridgePermissionRequestSchema = Schema.Struct({
  modelId: Schema.String,
});
export type BridgePermissionRequest = Schema.Schema.Type<
  typeof BridgePermissionRequestSchema
>;

export const RuntimeChatSendMessagesInputSchema = Schema.Struct({
  origin: Schema.String,
  chatId: Schema.String,
  modelId: Schema.String,
  trigger: RuntimeChatSendTriggerSchema,
  messageId: Schema.optional(Schema.String),
  messages: Schema.Array(RuntimeChatMessageSchema),
  options: Schema.optional(RuntimeChatCallOptionsSchema),
});
export type RuntimeChatSendMessagesInput = Schema.Schema.Type<
  typeof RuntimeChatSendMessagesInputSchema
>;

export const RuntimeChatReconnectStreamInputSchema = Schema.Struct({
  origin: Schema.String,
  chatId: Schema.String,
});
export type RuntimeChatReconnectStreamInput = Schema.Schema.Type<
  typeof RuntimeChatReconnectStreamInputSchema
>;

export const RuntimeAbortChatStreamInputSchema = Schema.Struct({
  origin: Schema.String,
  chatId: Schema.String,
});
export type RuntimeAbortChatStreamInput = Schema.Schema.Type<
  typeof RuntimeAbortChatStreamInputSchema
>;

export const BridgeModelRequestSchema = Schema.Struct({
  modelId: Schema.String,
  requestId: Schema.optional(Schema.String),
  sessionID: Schema.optional(Schema.String),
});
export type BridgeModelRequest = Schema.Schema.Type<
  typeof BridgeModelRequestSchema
>;

export const BridgeModelCallRequestSchema = Schema.Struct({
  requestId: Schema.optional(Schema.String),
  sessionID: Schema.optional(Schema.String),
  modelId: Schema.String,
  options: Schema.optional(RuntimeModelCallOptionsSchema),
});
export type BridgeModelCallRequest = Schema.Schema.Type<
  typeof BridgeModelCallRequestSchema
>;

export const BridgeAbortRequestSchema = Schema.Struct({
  requestId: Schema.optional(Schema.String),
  sessionID: Schema.optional(Schema.String),
});
export type BridgeAbortRequest = Schema.Schema.Type<
  typeof BridgeAbortRequestSchema
>;

export const BridgeChatSendMessagesRequestSchema = Schema.Struct({
  chatId: Schema.String,
  modelId: Schema.String,
  trigger: RuntimeChatSendTriggerSchema,
  messageId: Schema.optional(Schema.String),
  messages: Schema.Array(RuntimeChatMessageSchema),
  options: Schema.optional(RuntimeChatCallOptionsSchema),
});
export type BridgeChatSendMessagesRequest = Schema.Schema.Type<
  typeof BridgeChatSendMessagesRequestSchema
>;

export const BridgeChatReconnectStreamRequestSchema = Schema.Struct({
  chatId: Schema.String,
});
export type BridgeChatReconnectStreamRequest = Schema.Schema.Type<
  typeof BridgeChatReconnectStreamRequestSchema
>;

export const BridgeAbortChatStreamRequestSchema = Schema.Struct({
  chatId: Schema.String,
});
export type BridgeAbortChatStreamRequest = Schema.Schema.Type<
  typeof BridgeAbortChatStreamRequestSchema
>;

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
});
export type BridgeProviderState = Schema.Schema.Type<
  typeof BridgeProviderStateSchema
>;

export const BridgeStateResponseSchema = Schema.Struct({
  providers: Schema.Array(BridgeProviderStateSchema),
  permissions: Schema.Array(RuntimePermissionEntrySchema),
  pendingRequests: Schema.Array(RuntimePendingRequestSchema),
  originEnabled: Schema.Boolean,
  currentOrigin: Schema.String,
});
export type BridgeStateResponse = Schema.Schema.Type<
  typeof BridgeStateResponseSchema
>;

export const BridgeListModelsResponseSchema = Schema.Struct({
  models: Schema.Array(RuntimeModelSummarySchema),
});
export type BridgeListModelsResponse = Schema.Schema.Type<
  typeof BridgeListModelsResponseSchema
>;

export const BridgeModelDescriptorResponseSchema = RuntimeModelDescriptorSchema;
export type BridgeModelDescriptorResponse = Schema.Schema.Type<
  typeof BridgeModelDescriptorResponseSchema
>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toBase64(input: Uint8Array) {
  let binary = "";
  for (const value of input) {
    binary += String.fromCharCode(value);
  }
  return btoa(binary);
}

function fromBase64(input: string) {
  const binary = atob(input);
  const value = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    value[index] = binary.charCodeAt(index);
  }
  return value;
}

export function encodeRuntimeWireValue(value: unknown): RuntimeWireValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (value === undefined) {
    return {
      [WIRE_TYPE_KEY]: "undefined",
    };
  }

  if (value instanceof URL) {
    return {
      [WIRE_TYPE_KEY]: "url",
      href: value.toString(),
    };
  }

  if (value instanceof Uint8Array) {
    return {
      [WIRE_TYPE_KEY]: "uint8array",
      base64: toBase64(value),
    };
  }

  if (value instanceof Date) {
    return {
      [WIRE_TYPE_KEY]: "date",
      iso: value.toISOString(),
    };
  }

  if (value instanceof Error) {
    return {
      [WIRE_TYPE_KEY]: "error",
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }

  if (Array.isArray(value)) {
    return value.map((entry) => encodeRuntimeWireValue(entry));
  }

  if (isRecord(value)) {
    const entries = Object.entries(value).map(
      ([key, entry]) => [key, encodeRuntimeWireValue(entry)] as const,
    );
    return Object.fromEntries(entries);
  }

  return String(value);
}

export function decodeRuntimeWireValue(value: RuntimeWireValue): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => decodeRuntimeWireValue(entry));
  }

  if (isRecord(value) && value[WIRE_TYPE_KEY] === "undefined") {
    return undefined;
  }

  if (
    isRecord(value) &&
    value[WIRE_TYPE_KEY] === "url" &&
    typeof value.href === "string"
  ) {
    return new URL(value.href);
  }

  if (
    isRecord(value) &&
    value[WIRE_TYPE_KEY] === "uint8array" &&
    typeof value.base64 === "string"
  ) {
    return fromBase64(value.base64);
  }

  if (
    isRecord(value) &&
    value[WIRE_TYPE_KEY] === "date" &&
    typeof value.iso === "string"
  ) {
    return new Date(value.iso);
  }

  if (
    isRecord(value) &&
    value[WIRE_TYPE_KEY] === "error" &&
    typeof value.message === "string" &&
    typeof value.name === "string"
  ) {
    const error = new Error(value.message);
    error.name = value.name;
    if (typeof value.stack === "string") {
      error.stack = value.stack;
    }
    return error;
  }

  const decoded = Object.entries(value).map(
    ([key, entry]) => [key, decodeRuntimeWireValue(entry)] as const,
  );
  return Object.fromEntries(decoded);
}

export function encodeSupportedUrls(
  input: Record<string, RegExp[]> | undefined,
): RuntimeModelDescriptor["supportedUrls"] {
  if (!input) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(input).map(([mediaType, patterns]) => [
      mediaType,
      patterns.map((pattern) => ({
        source: pattern.source,
        flags: pattern.flags,
      })),
    ]),
  );
}

export function decodeSupportedUrls(
  input: RuntimeModelDescriptor["supportedUrls"],
): Record<string, RegExp[]> {
  return Object.fromEntries(
    Object.entries(input).map(([mediaType, patterns]) => [
      mediaType,
      patterns.map(
        (pattern) => new RegExp(pattern.source, pattern.flags ?? ""),
      ),
    ]),
  );
}

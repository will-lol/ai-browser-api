import * as Schema from "effect/Schema";
import {
  decodeSchemaOrThrow,
  decodeSchemaOrUndefined,
  decodeSchemaSync,
} from "@/lib/runtime/effect-schema";

type ModelsDevModality = "text" | "audio" | "image" | "video" | "pdf";
type ModelsDevInterleaved =
  | boolean
  | {
      field: "reasoning_content" | "reasoning_details";
    };

type ModelsDevCost = {
  input: number;
  output: number;
  cache_read?: number;
  cache_write?: number;
  [key: string]: unknown;
};

type ModelsDevLimit = {
  context: number;
  input?: number;
  output: number;
  [key: string]: unknown;
};

type ModelsDevModalities = {
  input: readonly ModelsDevModality[];
  output: readonly ModelsDevModality[];
  [key: string]: unknown;
};

type ModelsDevProviderMetadata = {
  npm?: string;
  api?: string;
  [key: string]: unknown;
};

export type ModelsDevModel = {
  id: string;
  name: string;
  family?: string;
  release_date: string;
  attachment: boolean;
  reasoning: boolean;
  temperature: boolean;
  tool_call: boolean;
  interleaved?: ModelsDevInterleaved;
  cost?: ModelsDevCost;
  limit: ModelsDevLimit;
  modalities?: ModelsDevModalities;
  options?: Record<string, unknown>;
  headers?: Record<string, string>;
  provider?: ModelsDevProviderMetadata;
  status?: "alpha" | "beta" | "deprecated";
  variants?: Record<string, Record<string, unknown>>;
  [key: string]: unknown;
};

export type ModelsDevProvider = {
  id: string;
  name: string;
  env: readonly string[];
  api?: string;
  npm?: string;
  models: Record<string, ModelsDevModel>;
  [key: string]: unknown;
};

export type ModelsDevData = Record<string, ModelsDevProvider>;

const unknownRecordSchema = Schema.Record({
  key: Schema.String,
  value: Schema.Unknown,
});

const stringArraySchema = Schema.Array(Schema.String);
const stringRecordSchema = Schema.Record({
  key: Schema.String,
  value: Schema.String,
});
const unknownRecordMapSchema = Schema.Record({
  key: Schema.String,
  value: Schema.Unknown,
});
const unknownRecordMapMapSchema = Schema.Record({
  key: Schema.String,
  value: unknownRecordMapSchema,
});

const interleavedSchema = Schema.Union(
  Schema.Boolean,
  Schema.Struct({
    field: Schema.Literal("reasoning_content", "reasoning_details"),
  }),
);

const costSchema = Schema.Struct({
  input: Schema.Number,
  output: Schema.Number,
  cache_read: Schema.optional(Schema.Number),
  cache_write: Schema.optional(Schema.Number),
});

const limitSchema = Schema.Struct({
  context: Schema.Number,
  input: Schema.optional(Schema.Number),
  output: Schema.Number,
});

const modalitiesSchema = Schema.Struct({
  input: Schema.Array(Schema.Literal("text", "audio", "image", "video", "pdf")),
  output: Schema.Array(
    Schema.Literal("text", "audio", "image", "video", "pdf"),
  ),
});

const providerMetadataSchema = Schema.Struct({
  npm: Schema.optional(Schema.String),
  api: Schema.optional(Schema.String),
});

const modelStatusSchema = Schema.Literal("alpha", "beta", "deprecated");

function asRecord(value: unknown, message: string): Record<string, unknown> {
  const decoded = decodeSchemaOrUndefined(unknownRecordSchema, value);
  if (!decoded) {
    throw new Error(message);
  }
  return { ...decoded };
}

function parseModel(modelID: string, value: unknown): ModelsDevModel {
  const record = asRecord(value, `Model ${modelID} must be an object.`);

  return {
    ...record,
    id: decodeSchemaOrUndefined(Schema.String, record.id) ?? modelID,
    name: decodeSchemaOrUndefined(Schema.String, record.name) ?? modelID,
    family: decodeSchemaOrUndefined(Schema.String, record.family),
    release_date: decodeSchemaOrThrow(
      Schema.String,
      record.release_date,
      `Model ${modelID} is missing release_date.`,
    ),
    attachment: decodeSchemaOrThrow(
      Schema.Boolean,
      record.attachment,
      `Model ${modelID} is missing attachment.`,
    ),
    reasoning: decodeSchemaOrThrow(
      Schema.Boolean,
      record.reasoning,
      `Model ${modelID} is missing reasoning.`,
    ),
    temperature:
      decodeSchemaOrUndefined(Schema.Boolean, record.temperature) ?? false,
    tool_call: decodeSchemaOrThrow(
      Schema.Boolean,
      record.tool_call,
      `Model ${modelID} is missing tool_call.`,
    ),
    interleaved: decodeSchemaOrUndefined(interleavedSchema, record.interleaved),
    cost: record.cost
      ? {
          ...asRecord(record.cost, `Model ${modelID} cost must be an object.`),
          ...decodeSchemaSync(costSchema, record.cost),
        }
      : undefined,
    limit: {
      ...asRecord(record.limit, `Model ${modelID} limit must be an object.`),
      ...decodeSchemaSync(limitSchema, record.limit),
    },
    modalities: record.modalities
      ? {
          ...asRecord(
            record.modalities,
            `Model ${modelID} modalities must be an object.`,
          ),
          ...decodeSchemaSync(modalitiesSchema, record.modalities),
        }
      : undefined,
    options: decodeSchemaOrUndefined(unknownRecordMapSchema, record.options),
    headers: decodeSchemaOrUndefined(stringRecordSchema, record.headers),
    provider: record.provider
      ? {
          ...asRecord(
            record.provider,
            `Model ${modelID} provider metadata must be an object.`,
          ),
          ...decodeSchemaSync(providerMetadataSchema, record.provider),
        }
      : undefined,
    status: decodeSchemaOrUndefined(modelStatusSchema, record.status),
    variants: decodeSchemaOrUndefined(
      unknownRecordMapMapSchema,
      record.variants,
    ),
  };
}

function parseProvider(providerID: string, value: unknown): ModelsDevProvider {
  const record = asRecord(value, `Provider ${providerID} must be an object.`);
  const modelsRecord = asRecord(
    record.models,
    `Provider ${providerID} models must be an object.`,
  );

  return {
    ...record,
    id: decodeSchemaOrUndefined(Schema.String, record.id) ?? providerID,
    name: decodeSchemaOrUndefined(Schema.String, record.name) ?? providerID,
    env: [
      ...decodeSchemaOrThrow(
        stringArraySchema,
        record.env,
        `Provider ${providerID} env must be a string array.`,
      ),
    ],
    api: decodeSchemaOrUndefined(Schema.String, record.api),
    npm: decodeSchemaOrUndefined(Schema.String, record.npm),
    models: Object.fromEntries(
      Object.entries(modelsRecord).map(([modelID, modelValue]) => [
        modelID,
        parseModel(modelID, modelValue),
      ]),
    ),
  };
}

export function parseModelsDevData(input: unknown): ModelsDevData {
  const providers = asRecord(input, "models.dev snapshot must be an object.");

  return Object.fromEntries(
    Object.entries(providers).map(([providerID, providerValue]) => [
      providerID,
      parseProvider(providerID, providerValue),
    ]),
  );
}

export function parseModelsDevSnapshotText(text: string): ModelsDevData {
  return parseModelsDevData(JSON.parse(text) as unknown);
}

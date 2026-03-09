import { z } from "zod";

const modelsDevModalitySchema = z.enum(["text", "audio", "image", "video", "pdf"]);

const modelsDevInterleavedSchema = z.union([
  z.boolean(),
  z.object({
    field: z.enum(["reasoning_content", "reasoning_details"]),
  }),
]);

const modelsDevCostSchema = z.looseObject({
  input: z.number(),
  output: z.number(),
  cache_read: z.number().optional(),
  cache_write: z.number().optional(),
});

const modelsDevLimitSchema = z.looseObject({
  context: z.number(),
  input: z.number().optional(),
  output: z.number(),
});

const modelsDevModalitiesSchema = z.looseObject({
  input: z.array(modelsDevModalitySchema),
  output: z.array(modelsDevModalitySchema),
});

const modelsDevProviderMetadataSchema = z.looseObject({
  npm: z.string().optional(),
  api: z.string().optional(),
});

const modelsDevModelSchema = z.looseObject({
  id: z.string().optional(),
  name: z.string().optional(),
  family: z.string().optional(),
  release_date: z.string(),
  attachment: z.boolean(),
  reasoning: z.boolean(),
  temperature: z.boolean().default(false),
  tool_call: z.boolean(),
  interleaved: modelsDevInterleavedSchema.optional(),
  cost: modelsDevCostSchema.optional(),
  limit: modelsDevLimitSchema,
  modalities: modelsDevModalitiesSchema.optional(),
  options: z.record(z.string(), z.unknown()).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  provider: modelsDevProviderMetadataSchema.optional(),
  status: z.enum(["alpha", "beta", "deprecated"]).optional(),
  variants: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
});

function prependIssues(
  ctx: z.RefinementCtx,
  pathPrefix: Array<string | number>,
  issues: z.core.$ZodIssue[],
) {
  for (const issue of issues) {
    ctx.addIssue({
      ...issue,
      path: [...pathPrefix, ...(issue.path ?? [])],
    });
  }
}

function createModelsDevModelSchema(modelID: string) {
  return modelsDevModelSchema.transform(
    (model) => ({
      ...model,
      id: model.id ?? modelID,
      name: model.name ?? modelID,
    }),
  );
}

export type ModelsDevModel = z.infer<ReturnType<typeof createModelsDevModelSchema>>;

const rawModelsDevModelRecordSchema = z.record(z.string(), z.unknown());

const modelsDevModelRecordSchema = rawModelsDevModelRecordSchema.transform(
  (models, ctx): Record<string, ModelsDevModel> => {
    let hasError = false;
    const parsedModels: Record<string, ModelsDevModel> = {};

    for (const [modelID, rawModel] of Object.entries(models)) {
      const result = createModelsDevModelSchema(modelID).safeParse(rawModel);
      if (!result.success) {
        hasError = true;
        prependIssues(ctx, [modelID], result.error.issues);
        continue;
      }

      parsedModels[modelID] = result.data;
    }

    return hasError ? z.NEVER : parsedModels;
  },
);

const modelsDevProviderSchema = z.looseObject({
  id: z.string().optional(),
  name: z.string().optional(),
  env: z.array(z.string()),
  api: z.string().optional(),
  npm: z.string().optional(),
  models: modelsDevModelRecordSchema,
});

function createModelsDevProviderSchema(providerID: string) {
  return modelsDevProviderSchema.transform(
    (provider) => ({
      ...provider,
      id: provider.id ?? providerID,
      name: provider.name ?? providerID,
    }),
  );
}

export type ModelsDevProvider = z.infer<
  ReturnType<typeof createModelsDevProviderSchema>
>;

const modelsDevDataSchema = z
  .record(z.string(), z.unknown())
  .transform((providers, ctx): Record<string, ModelsDevProvider> => {
    let hasError = false;
    const parsedProviders: Record<string, ModelsDevProvider> = {};

    for (const [providerID, rawProvider] of Object.entries(providers)) {
      const result = createModelsDevProviderSchema(providerID).safeParse(rawProvider);
      if (!result.success) {
        hasError = true;
        prependIssues(ctx, [providerID], result.error.issues);
        continue;
      }

      parsedProviders[providerID] = result.data;
    }

    return hasError ? z.NEVER : parsedProviders;
  });

export type ModelsDevData = z.infer<typeof modelsDevDataSchema>;

export function parseModelsDevData(input: unknown): ModelsDevData {
  return modelsDevDataSchema.parse(input);
}

export function parseModelsDevSnapshotText(text: string): ModelsDevData {
  return parseModelsDevData(JSON.parse(text) as unknown);
}

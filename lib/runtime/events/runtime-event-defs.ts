import { z } from "zod"

export const RuntimeEventPayloadSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("runtime.providers.changed"),
    payload: z.object({
      providerIDs: z.array(z.string()).default([]),
    }),
  }),
  z.object({
    type: z.literal("runtime.models.changed"),
    payload: z.object({
      providerIDs: z.array(z.string()).default([]),
    }),
  }),
  z.object({
    type: z.literal("runtime.auth.changed"),
    payload: z.object({
      providerID: z.string(),
    }),
  }),
  z.object({
    type: z.literal("runtime.origin.changed"),
    payload: z.object({
      origin: z.string(),
    }),
  }),
  z.object({
    type: z.literal("runtime.permissions.changed"),
    payload: z.object({
      origin: z.string(),
      modelIds: z.array(z.string()).default([]),
    }),
  }),
  z.object({
    type: z.literal("runtime.pending.changed"),
    payload: z.object({
      origin: z.string(),
      requestIds: z.array(z.string()).default([]),
    }),
  }),
  z.object({
    type: z.literal("runtime.catalog.refreshed"),
    payload: z.object({
      updatedAt: z.number(),
    }),
  }),
])

export type RuntimeEventPayload = z.infer<typeof RuntimeEventPayloadSchema>

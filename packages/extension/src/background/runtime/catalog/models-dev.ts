import snapshotData from "@/background/runtime/catalog/models-snapshot.json";
import * as Effect from "effect/Effect";
import type { ModelsDevData } from "@/background/runtime/catalog/models-dev-schema";

export type {
  ModelsDevModel,
  ModelsDevProvider,
} from "@/background/runtime/catalog/models-dev-schema";

export const modelsDevData = snapshotData as ModelsDevData;

export function getModelsDevData() {
  return Effect.succeed(modelsDevData);
}

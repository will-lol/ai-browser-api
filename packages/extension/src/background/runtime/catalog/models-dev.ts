import snapshotData from "@/background/runtime/catalog/models-snapshot.json";
import type { ModelsDevData } from "@/background/runtime/catalog/models-dev-schema";

export type {
  ModelsDevModel,
  ModelsDevProvider,
} from "@/background/runtime/catalog/models-dev-schema";

export const modelsDevData = snapshotData as ModelsDevData;

export async function getModelsDevData() {
  return modelsDevData;
}

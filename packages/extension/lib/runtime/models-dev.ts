import snapshotData from "@/lib/runtime/models-snapshot.json";
import type { ModelsDevData } from "@/lib/runtime/models-dev-schema";

export type {
  ModelsDevData,
  ModelsDevModel,
  ModelsDevProvider,
} from "@/lib/runtime/models-dev-schema";

export const modelsDevData = snapshotData as ModelsDevData;

export async function getModelsDevData() {
  return modelsDevData;
}

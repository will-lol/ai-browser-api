import snapshotData from "@/background/runtime/models-snapshot.json";
import type { ModelsDevData } from "@/background/runtime/models-dev-schema";

export type {
  ModelsDevModel,
  ModelsDevProvider,
} from "@/background/runtime/models-dev-schema";

export const modelsDevData = snapshotData as ModelsDevData;

export async function getModelsDevData() {
  return modelsDevData;
}

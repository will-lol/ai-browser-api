import * as Layer from "effect/Layer";
import { ChatExecutionServiceLive } from "@/background/runtime/execution/chat-execution-service";
import { AuthFlowServiceLive } from "@/background/services/auth-flow-service";
import { CatalogServiceLive } from "@/background/services/catalog-service";
import { MetaServiceLive } from "@/background/services/meta-service";
import { ModelExecutionServiceLive } from "@/background/services/model-execution-service";
import { PermissionsServiceLive } from "@/background/services/permissions-service";

export function makeRuntimeCoreInfrastructureLayer() {
  const baseLayer = Layer.mergeAll(
    CatalogServiceLive,
    PermissionsServiceLive,
    MetaServiceLive,
    ModelExecutionServiceLive,
    ChatExecutionServiceLive,
  );

  const authFlowLayer = AuthFlowServiceLive.pipe(Layer.provide(baseLayer));

  return Layer.merge(baseLayer, authFlowLayer);
}

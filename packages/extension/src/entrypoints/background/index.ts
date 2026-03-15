import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { startup } from "@llm-bridge/runtime-core";
import { defineBackground } from "wxt/utils/define-background";
import { makeRuntimeCoreInfrastructureLayer } from "@/background/rpc/runtime-adapters";
import {
  RuntimeAdminRpcHandlersLive,
  RuntimePublicRpcHandlersLive,
} from "@/background/rpc/runtime-rpc-handlers";
import { makeRuntimeRpcServerLayer } from "@/background/rpc/runtime-rpc-server";
import { ToolbarProjectionLive } from "@/background/toolbar/toolbar-projection";

const RuntimeServicesLive = makeRuntimeCoreInfrastructureLayer();

const RuntimeStartupLive = Layer.effectDiscard(startup()).pipe(
  Layer.provide(RuntimeServicesLive),
);

const RuntimePublicRpcHandlersLayer = RuntimePublicRpcHandlersLive.pipe(
  Layer.provide(RuntimeServicesLive),
);

const RuntimeAdminRpcHandlersLayer = RuntimeAdminRpcHandlersLive.pipe(
  Layer.provide(RuntimeServicesLive),
);

const RuntimeRpcServerLive = makeRuntimeRpcServerLayer({
  publicLayer: RuntimePublicRpcHandlersLayer,
  adminLayer: RuntimeAdminRpcHandlersLayer,
});

const BackgroundAppLive = Layer.mergeAll(
  RuntimeStartupLive,
  ToolbarProjectionLive.pipe(Layer.provide(RuntimeServicesLive)),
  RuntimeRpcServerLive,
);

export default defineBackground(() => {
  void Effect.runPromise(Layer.launch(BackgroundAppLive));
});

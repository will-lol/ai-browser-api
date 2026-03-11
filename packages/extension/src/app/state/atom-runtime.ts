import * as Context from "effect/Context";
import * as Layer from "effect/Layer";
import { createReactiveRuntime } from "@llm-bridge/reactive-core";
import { getRuntimeAdminRPC } from "@/app/rpc/runtime-rpc-client";

type ExtensionRuntimeAdminRpcClient = ReturnType<typeof getRuntimeAdminRPC>;

class ExtensionRuntimeAdminClient extends Context.Tag(
  "@llm-bridge/extension/ExtensionRuntimeAdminClient",
)<ExtensionRuntimeAdminClient, ExtensionRuntimeAdminRpcClient>() {}

const ExtensionRuntimeAdminClientLive = Layer.sync(
  ExtensionRuntimeAdminClient,
  () => getRuntimeAdminRPC(),
);

export const extensionReactiveRuntime = createReactiveRuntime(
  ExtensionRuntimeAdminClientLive,
);

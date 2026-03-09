import { Atom } from "@effect-atom/atom-react";
import * as Context from "effect/Context";
import * as Layer from "effect/Layer";
import { getRuntimeAdminRPC } from "@/lib/runtime/rpc/runtime-admin-rpc-client";

type ExtensionRuntimeAdminRpcClient = ReturnType<
  typeof getRuntimeAdminRPC
>;

class ExtensionRuntimeAdminClient extends Context.Tag(
  "@llm-bridge/extension/ExtensionRuntimeAdminClient",
)<ExtensionRuntimeAdminClient, ExtensionRuntimeAdminRpcClient>() {}

const ExtensionRuntimeAdminClientLive = Layer.sync(
  ExtensionRuntimeAdminClient,
  () => getRuntimeAdminRPC(),
);

export const extensionAtomRuntime = Atom.runtime(
  ExtensionRuntimeAdminClientLive,
);

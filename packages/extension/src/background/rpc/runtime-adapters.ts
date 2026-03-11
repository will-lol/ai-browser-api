import {
  RuntimeEnvironment,
  type RuntimeEnvironmentApi,
} from "@llm-bridge/runtime-core";
import * as Layer from "effect/Layer";
import { makeRuntimeAuthEnvironment } from "@/background/rpc/runtime-auth-environment";
import { makeRuntimeCatalogEnvironment } from "@/background/rpc/runtime-catalog-environment";
import { makeRuntimeMetaEnvironment } from "@/background/rpc/runtime-meta-environment";
import { makeRuntimeModelExecutionEnvironment } from "@/background/rpc/runtime-model-environment";
import { makeRuntimePermissionsEnvironment } from "@/background/rpc/runtime-permissions-environment";
import { makeRuntimeQueryEnvironment } from "@/background/rpc/runtime-query-environment";

export function makeRuntimeCoreInfrastructureLayer() {
  const query = makeRuntimeQueryEnvironment();
  const runtimeEnvironment = {
    ...query,
    auth: makeRuntimeAuthEnvironment(),
    permissions: makeRuntimePermissionsEnvironment(),
    meta: makeRuntimeMetaEnvironment(),
    modelExecution: makeRuntimeModelExecutionEnvironment(),
    catalog: makeRuntimeCatalogEnvironment(),
  } satisfies RuntimeEnvironmentApi;

  return Layer.succeed(RuntimeEnvironment, runtimeEnvironment);
}

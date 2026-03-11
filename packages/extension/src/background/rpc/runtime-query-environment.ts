import type { RuntimeEnvironmentApi } from "@llm-bridge/runtime-core";
import {
  listModels,
  listPendingRequestsForOrigin,
  listProviders,
} from "@/background/runtime/query/query-service";

export function makeRuntimeQueryEnvironment(): Pick<
  RuntimeEnvironmentApi,
  "providers" | "models" | "pending"
> {
  return {
    providers: {
      listProviders,
    },
    models: {
      listModels,
    },
    pending: {
      listPending: listPendingRequestsForOrigin,
    },
  };
}

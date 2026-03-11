import { createContext, type ReactNode, useContext, useMemo } from "react";
import { ReactiveRuntimeProvider } from "@llm-bridge/reactive-core";
import {
  createBridgeResources,
  type BridgeResources,
} from "./resources";
import type { BridgeClientOptions } from "@llm-bridge/client";

const BridgeResourcesContext = createContext<BridgeResources | null>(null);

export function BridgeProvider({
  children,
  options,
}: {
  children: ReactNode;
  options?: BridgeClientOptions;
}) {
  const resources = useMemo(() => createBridgeResources(options), [options]);

  return (
    <BridgeResourcesContext.Provider value={resources}>
      <ReactiveRuntimeProvider>{children}</ReactiveRuntimeProvider>
    </BridgeResourcesContext.Provider>
  );
}

export function useBridgeResources() {
  const context = useContext(BridgeResourcesContext);
  if (!context) {
    throw new Error("BridgeProvider is required to use @llm-bridge/client-react hooks.");
  }
  return context;
}

import { ReactiveRuntimeProvider } from "@llm-bridge/reactive-core";
import { type ReactNode } from "react";
import { runtimeEventReactivityBridgeResource } from "@/app/state/runtime-reactivity";

export function ExtensionAtomProvider({ children }: { children: ReactNode }) {
  return (
    <ReactiveRuntimeProvider
      keepAliveResources={[runtimeEventReactivityBridgeResource]}
    >
      {children}
    </ReactiveRuntimeProvider>
  );
}

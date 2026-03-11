import { RegistryProvider, useAtomMount } from "@effect-atom/atom-react";
import { type ReactNode } from "react";
import { runtimeEventReactivityBridgeAtom } from "@/app/state/runtime-reactivity";

function RuntimeEventReactivityBridge() {
  useAtomMount(runtimeEventReactivityBridgeAtom);
  return null;
}

export function ExtensionAtomProvider({ children }: { children: ReactNode }) {
  return (
    <RegistryProvider>
      <RuntimeEventReactivityBridge />
      {children}
    </RegistryProvider>
  );
}

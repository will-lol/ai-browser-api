import { ReactiveRuntimeProvider } from "@llm-bridge/reactive-core";
import { type ReactNode } from "react";

export function ExtensionAtomProvider({ children }: { children: ReactNode }) {
  return <ReactiveRuntimeProvider>{children}</ReactiveRuntimeProvider>;
}

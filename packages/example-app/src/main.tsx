import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BridgeProvider } from "@llm-bridge/client-react";
import { App } from "./App";
import "./styles.css";

const container = document.getElementById("root");
if (!container) {
  throw new Error("Missing #root mount node");
}

createRoot(container).render(
  <StrictMode>
    <BridgeProvider>
      <App />
    </BridgeProvider>
  </StrictMode>,
);

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "../../index.css";
import "@vscode/codicons/dist/codicon.css";
import "../../codicon-custom.css";
import "katex/dist/katex.min.css";

import NativeAgentManagerApp from "./NativeAgentManagerApp";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <NativeAgentManagerApp />
  </StrictMode>,
);

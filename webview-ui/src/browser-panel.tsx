import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "./index.css";
import BrowserSessionPanel from "./components/browser-session/BrowserSessionPanel";
import "../node_modules/@vscode/codicons/dist/codicon.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  console.error("Browser session root element #root was not found.");
} else {
  createRoot(rootElement).render(
    <StrictMode>
      <BrowserSessionPanel />
    </StrictMode>,
  );
}

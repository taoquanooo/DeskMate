import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

const view = new URLSearchParams(window.location.search).get("view") ?? "settings";
document.body.classList.add(`view-${view}`);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

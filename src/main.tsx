import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { initializeSurfaceWasm } from "./threejsVTK/src/wasm/surfaceExtractorWasm.js";

// Warm up the optional accelerator while the UI starts. Surface extraction
// transparently stays on the JavaScript implementation until this is ready.
void initializeSurfaceWasm();

ReactDOM.createRoot(document.getElementById("root")).render(
    <App />
);

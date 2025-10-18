import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";

// If you want Tailwind, add it via CDN (quick) or full PostCSS pipeline.
// Quick CDN (no build-step CSS): uncomment next line for prototypes.
// import "https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css";

createRoot(document.getElementById("root")).render(<App />);

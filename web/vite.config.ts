import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In dev, the FastAPI server (codecopilot serve / uvicorn api:app) runs on :8000.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": "http://127.0.0.1:8000" },
  },
});

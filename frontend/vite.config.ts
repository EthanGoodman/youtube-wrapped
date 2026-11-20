import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// `npm run dev` serves the UI on :5173 and forwards /api to the Python server on :8000
// (start it with `python run.py --no-browser`).
export default defineConfig({
  plugins: [react()],
  server: { proxy: { "/api": "http://127.0.0.1:8000" } },
  build: {
    chunkSizeWarningLimit: 1500,
    rollupOptions: { output: { manualChunks: { echarts: ["echarts", "echarts-for-react"] } } },
  },
});

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@drishti/shared": path.resolve(__dirname, "../shared/src/types.ts"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8000",
      "/socket.io": { target: "http://localhost:8000", ws: true },
    },
  },
});

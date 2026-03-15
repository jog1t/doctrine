import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  root: path.resolve(__dirname),
  resolve: {
    alias: {
      "@doctrine/shared": path.resolve(__dirname, "../shared/src/index.ts"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api/rivet": {
        target: "http://localhost:6420",
        changeOrigin: true,
        ws: true,
        rewrite: (path) => path.replace(/^\/api\/rivet/, ""),
      },
    },
  },
});

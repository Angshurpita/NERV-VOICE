import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Consumed from source rather than a build step, so the shared speech
      // normalisation stays in one place for both apps.
      "@echosphere/core": path.resolve(
        import.meta.dirname,
        "../../packages/core/src/index.ts",
      ),
    },
  },
  server: { port: 5174, host: true },
  preview: { port: 5174 },
});

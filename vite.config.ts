// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
import path from "node:path";
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    server: { entry: "server" },
  },

  // Requirement 9: deploy on Vercel. Nitro auto-detects the platform when
  // building there, so this only pins it for local `vite build` and any CI that
  // is not Vercel itself. The wrapper documents `preset` as the supported knob.
  nitro: { preset: "vercel" },

  vite: {
    resolve: {
      alias: {
        // The dashboard shares the speech-text normalisation and domain types
        // with the API and the caller app. Consumed from source so there is no
        // build step between the three.
        "@echosphere/core": path.resolve(import.meta.dirname, "packages/core/src/index.ts"),
      },
    },
    server: { port: 3000 },
  },
});

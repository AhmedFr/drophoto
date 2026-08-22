import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config";

// Node 22+'s built-in global `localStorage` (stable behind
// --experimental-webstorage in earlier releases) shadows jsdom's
// window.localStorage in test workers, leaving a non-functional stub.
// Disabling it before workers spawn lets jsdom's own implementation back
// a real localStorage for persisted stores.
process.env.NODE_OPTIONS = `${process.env.NODE_OPTIONS ?? ""} --no-experimental-webstorage`.trim();

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      globals: true,
      environment: "jsdom",
      setupFiles: ["./src/test/setup.ts"],
      coverage: {
        provider: "v8",
        reporter: ["text", "lcov"],
        include: ["src/**/*.{ts,tsx}"],
        exclude: [
          "src/components/ui/**",
          "src/**/*.stories.tsx",
          "src/**/*.types.ts",
          "src/main.tsx",
          "src/test/**",
        ],
        thresholds: { lines: 80, branches: 75, "src/lib/**": { lines: 90 } },
      },
    },
  }),
);

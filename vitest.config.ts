import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config";

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

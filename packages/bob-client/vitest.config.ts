import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // The migration-guardrail tests shell out to `git ls-files` and read
    // hundreds of source files across apps/bob + apps/mobile-bob + packages/**.
    // That's comfortably under the 5s default locally, but a loaded CI runner
    // has intermittently blown it (measured ~7s). Give real headroom so a busy
    // runner doesn't flake the whole suite red.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});

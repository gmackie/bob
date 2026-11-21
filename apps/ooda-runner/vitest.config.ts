import { defineConfig } from "vitest/config";

export default defineConfig({
  // 30s ceiling: supervisor tests spawn real detached node processes, which
  // pay full node startup cost under cold CI transform load.
  test: {
    passWithNoTests: true,
    testTimeout: 30_000,
    globalSetup: ["./src/__tests__/global-setup.ts"],
    setupFiles: ["./src/__tests__/setup.ts"],
  },
});

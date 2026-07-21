import { defineConfig } from "vitest/config";

export default defineConfig({
  // 30s ceiling: supervisor tests spawn real detached node processes, which
  // pay full node startup cost under cold CI transform load.
  test: { passWithNoTests: true, testTimeout: 30_000 },
});

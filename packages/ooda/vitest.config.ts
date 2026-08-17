import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    // The suite includes real Git repositories, child processes, and a cold
    // OpenAPI dependency-graph import. Running those files concurrently makes
    // otherwise healthy tests exceed their behavior-level timeouts on clean
    // worktrees and CI hosts. Keep the package baseline deterministic; focused
    // Vitest invocations remain available during red/green development.
    fileParallelism: false,
    name: "@gmacko/ooda",
    include: ["src/**/__tests__/**/*.test.ts", "src/**/*.test.ts"],
  },
});

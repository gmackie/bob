import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/__tests__/**/*.test.ts"],
    // The smoke test spawns `next dev` and waits for it to compile + start
    // serving — first-run cold compilation can take 20s+ on slower
    // machines. Generous timeouts keep the test stable in CI.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});

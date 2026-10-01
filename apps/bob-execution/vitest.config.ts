import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // The shared Forgejo runner is often starved (load ~15 on 4 cores); synchronous
    // fs tests that take <1 s locally have hit the 5 s default there.
    testTimeout: 30_000,
  },
});

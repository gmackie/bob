import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    name: "@gmacko/core",
    environment: "node",
    include: ["src/**/__tests__/**/*.test.ts", "src/**/*.test.ts"],
    // PGlite init can take a few seconds; the db schema tests boot a fresh
    // in-memory Postgres per `beforeEach`. Inherited from the previous
    // `packages/db/vitest.config.ts`.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});

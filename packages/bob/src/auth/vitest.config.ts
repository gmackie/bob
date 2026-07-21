import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.spec.ts"],
    // runtime.test.ts's beforeEach bootstraps a fresh in-memory PGlite
    // instance per test (via makePgliteDb) and applies Bob's full schema DDL
    // (including the gmacko auth tables). That's cheap locally but on a cold,
    // shared CI runner it can exceed vitest's default 10s hookTimeout --
    // observed failing in real CI ("Hook timed out in 10000ms") while passing
    // consistently locally. Match the generous hookTimeout already used by
    // @bob/db and @bob/api's vitest configs (see their comments) for the same
    // class of "slow first DB op on a cold CI runner" reason.
    hookTimeout: 60_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/**/*.spec.ts"],
    },
  },
});

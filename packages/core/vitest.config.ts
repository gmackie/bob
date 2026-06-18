import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "@gmacko/core",
    environment: "node",
    environmentMatchGlobs: [
      ["src/ui/**", "jsdom"],
      ["src/app-shell/**", "jsdom"],
      ["src/mobile-shell/**", "jsdom"],
      ["src/desktop-shell/**", "jsdom"],
    ],
    include: ["src/**/__tests__/**/*.test.{ts,tsx}", "src/**/*.test.{ts,tsx}"],
    setupFiles: ["./src/ui/__tests__/setup.ts"],
    globals: true,
    // PGlite init can take a few seconds; the db schema tests boot a fresh
    // in-memory Postgres per `beforeEach`. Inherited from the previous
    // `packages/db/vitest.config.ts`.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});

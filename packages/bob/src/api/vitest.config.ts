import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.spec.ts"],
    // ~21 test files under src/router/__tests__ talk to a real Postgres wire
    // protocol at postgres://postgres:postgres@localhost:5432/test, now
    // served in CI (and locally) by @gmacko/emulate's PGlite-backed postgres
    // mock instead of a Docker service container -- see
    // ../../../../test/emulate-setup.ts for why this is shared +
    // lock-coordinated across packages.
    globalSetup: ["../../../../test/emulate-setup.ts"],
    // @gmacko/emulate can take a while to install (cold npx cache) before its
    // globalSetup script resolves; vitest kills globalSetup after the default
    // 10s hookTimeout otherwise.
    hookTimeout: 200_000,
    // Default (5000ms) is too tight for the first PGlite query on a cold CI
    // runner: the emulator's postgres can take longer than 5s to answer its
    // first query right after boot, even though the globalSetup port-wait
    // itself already succeeded.
    testTimeout: 30_000,
    // Scoped here (not as a CI workflow step-level env var) so DATABASE_URL
    // doesn't leak into every other package's `turbo run test` process.
    // @gmacko/ooda's listen-broker.test.ts gates its Postgres LISTEN/NOTIFY
    // suite on `Boolean(process.env.DATABASE_URL)` -- it previously ran (and
    // passed) against the old Docker postgres:16 service container, which
    // supports LISTEN/NOTIFY. The emulator's PGlite-backed postgres does NOT
    // support LISTEN/NOTIFY (empirically verified: `sql.listen()` resolves,
    // but the connection then drops with ECONNRESET on the next query) --
    // setting DATABASE_URL only for @bob/db and @bob/api keeps @gmacko/ooda's
    // suite correctly skipped instead of failing against an incompatible
    // Postgres mock.
    env: {
      DATABASE_URL: "postgres://postgres:postgres@localhost:5432/test",
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/**/*.spec.ts"],
    },
  },
});

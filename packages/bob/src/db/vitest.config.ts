import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // @bob/db's test suite talks to a real Postgres wire protocol at
    // postgres://postgres:postgres@localhost:5432/test, now served in CI (and
    // locally) by @gmacko/emulate's PGlite-backed postgres mock instead of a
    // Docker service container -- see ../../../../test/emulate-setup.ts for
    // why this is shared + lock-coordinated across packages.
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
  },
});

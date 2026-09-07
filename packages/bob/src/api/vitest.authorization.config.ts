import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

if (process.env.BOB_AUTH_TEST_REQUIRE_DB === "1" && !process.env.BOB_AUTH_TEST_DATABASE_URL) {
  throw new Error("BOB_AUTH_TEST_DATABASE_URL is required for authorization persistence acceptance");
}

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  test: {
    environment: "node",
    // Deliberately no globalSetup: never starts/connects the default 5432 DB.
    include: [
      "src/handlers/__tests__/secret-authorization.test.ts",
      "src/handlers/__tests__/secret-usage-persistence.test.ts",
      "src/handlers/__tests__/filesystem.test.ts",
      "src/handlers/__tests__/local-filesystem-composition.test.ts",
      "src/router/__tests__/secrets.test.ts",
    ],
    env: { DATABASE_URL: "postgres://test:test@127.0.0.1:1/unused" },
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});

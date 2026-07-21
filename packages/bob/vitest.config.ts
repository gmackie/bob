import { defineConfig } from "vitest/config";

// @gmacko/bob (packages/bob) is both a package and the parent dir of 19 nested
// workspace packages (src/api, src/db, src/auth, …), each with its own vitest
// target + config. Vitest's default discovery would otherwise pull every
// nested package's *.test.ts into this run — but WITHOUT their per-package
// setup (the db/api suites need @gmacko/emulate's Postgres globalSetup +
// DATABASE_URL + raised timeouts), so they timed out and reddened CI.
//
// Scope this run to @gmacko/bob's OWN tests only (currently src/contracts,
// which need no Postgres). The nested packages run via their own turbo
// targets (@bob/api#test, @bob/db#test, …).
const NESTED_PACKAGES = [
  "agents", "api", "auth", "chat", "ci", "config", "cookies", "db",
  "execution", "git", "notifications", "projects", "secrets", "settings",
  "telemetry", "tenancy", "webhooks", "work-items", "ws",
];

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.spec.ts"],
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      ...NESTED_PACKAGES.map((p) => `src/${p}/**`),
    ],
  },
});

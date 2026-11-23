import { configDefaults, defineConfig } from "vitest/config";

// DOM-facing source trees run under jsdom; everything else under node.
// (Vitest 4+ removed `environmentMatchGlobs`; projects replace it.)
const jsdomDirs = [
  "src/ui",
  "src/app-shell",
  "src/mobile-shell",
  "src/desktop-shell",
];

const shared = {
  setupFiles: ["./src/ui/__tests__/setup.ts"],
  globals: true,
  // PGlite init can take a few seconds; the db schema tests boot a fresh
  // in-memory Postgres per `beforeEach`. Inherited from the previous
  // `packages/db/vitest.config.ts`.
  testTimeout: 30_000,
  hookTimeout: 30_000,
};

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          ...shared,
          name: "@gmacko/core",
          environment: "node",
          include: [
            "src/**/__tests__/**/*.test.{ts,tsx}",
            "src/**/*.test.{ts,tsx}",
          ],
          exclude: [
            ...configDefaults.exclude,
            ...jsdomDirs.map((dir) => `${dir}/**`),
          ],
        },
      },
      {
        test: {
          ...shared,
          name: "@gmacko/core:jsdom",
          environment: "jsdom",
          include: jsdomDirs.map((dir) => `${dir}/**/*.test.{ts,tsx}`),
        },
      },
    ],
  },
});

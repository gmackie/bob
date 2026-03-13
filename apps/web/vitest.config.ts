import path from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@bob\/api\/(.*)$/,
        replacement: path.resolve(__dirname, "../../packages/api/src/$1"),
      },
      {
        find: "@bob/api",
        replacement: path.resolve(__dirname, "../../packages/api/src/index.ts"),
      },
      {
        find: /^@bob\/db\/(.*)$/,
        replacement: path.resolve(__dirname, "../../packages/db/src/$1"),
      },
      {
        find: "@bob/db",
        replacement: path.resolve(__dirname, "../../packages/db/src/index.ts"),
      },
      {
        find: /^@bob\/execution\/(.*)$/,
        replacement: path.resolve(__dirname, "../execution/src/$1"),
      },
      {
        find: "@bob/execution",
        replacement: path.resolve(__dirname, "../execution/src/runtime/index.ts"),
      },
      {
        find: "~",
        replacement: path.resolve(__dirname, "src"),
      },
    ],
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/__tests__/**/*.ts"],
    exclude: ["e2e/**", "node_modules/**", ".next/**"],
    setupFiles: ["./vitest.setup.ts"],
  },
});

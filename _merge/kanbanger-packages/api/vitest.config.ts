import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globals: true,
  },
  resolve: {
    alias: {
      "@linear-clone/db": path.resolve(__dirname, "../db/src"),
      "@linear-clone/shared": path.resolve(__dirname, "../shared/src"),
    },
  },
});

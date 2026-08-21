import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "~": path.resolve(__dirname, "../src") },
  },
  test: {
    environment: "node",
    include: [
      "worker/runtime-env.test.ts",
      "src/app/api/openapi/route.test.ts",
      "src/lib/hermes-*.test.ts",
      "src/components/layout/__tests__/sidebar-nav-model.test.ts",
    ],
  },
});

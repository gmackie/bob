import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "worker/runtime-env.test.ts",
      "src/app/api/openapi/route.test.ts",
    ],
  },
});

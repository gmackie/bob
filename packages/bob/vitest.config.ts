import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    name: "@gmacko/bob",
    include: ["src/**/__tests__/**/*.test.ts", "src/**/*.test.ts"],
  },
});

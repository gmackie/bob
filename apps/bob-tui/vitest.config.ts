import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "@bob/tui",
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});

import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    include: ["tests/unit/**/*.test.{ts,tsx}"],
    setupFiles: ["./tests/setup.ts"],
    globals: true,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@linear-clone/shared": path.resolve(__dirname, "../../packages/shared/src"),
      "@linear-clone/api": path.resolve(__dirname, "./tests/mocks/linear-clone-api-mock"),
      "@linear-clone/api/src/services/outbound-webhook": path.resolve(
        __dirname,
        "./tests/mocks/linear-clone-api-mock/src/services/outbound-webhook.ts"
      ),
      "@linear-clone/db": path.resolve(__dirname, "../../packages/db/src"),
      "next/server": path.resolve(__dirname, "./tests/mocks/next-server"),
      zod: path.resolve(__dirname, "./tests/mocks/zod"),
    },
  },
});

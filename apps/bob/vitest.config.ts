// Keep unit tests independent from deployment Vite/Cloudflare plugins.
import { defineConfig } from "vitest/config";
export default defineConfig({
  root: import.meta.dirname,
  resolve: { alias: { "~": new URL("./src", import.meta.url).pathname } },
  oxc: { jsx: { runtime: "automatic" } },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "worker/**/*.test.ts"],
  },
});

import { defineConfig } from "vitest/config";

// Portable staging contains copied application tests, not desktop test suites.
export default defineConfig({ test: { include: ["src/**/*.test.ts", "scripts/**/*.test.mjs"] } });

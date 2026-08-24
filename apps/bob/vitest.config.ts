/**
 * Vitest must NOT inherit vite.config.ts here — the Cloudflare plugin in it
 * refuses to boot outside a real vite build. Unit tests in this app are plain
 * node-environment tests.
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
  },
});

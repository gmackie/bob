import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Phase 7B Batch 3 transitional shim: rpc imports `@gmacko/core/validators`
// for type-only context shapes and a few runtime Schema decoders in tests.
// `@gmacko/core` is not declared as an rpc dependency to avoid a workspace
// cycle (core depends on rpc; rpc-into-core is Batch 4). We resolve the
// subpath through a relative alias so vitest can find the validators module
// during tests; production consumers of @gmacko/rpc bring their own
// @gmacko/core install.
const coreValidators = fileURLToPath(
  new URL("../core/src/validators/index.ts", import.meta.url),
);

export default defineConfig({
  resolve: {
    alias: {
      "@gmacko/core/validators": coreValidators,
    },
  },
  test: {
    environment: "node",
    include: ["src/**/__tests__/**/*.test.ts"],
  },
});

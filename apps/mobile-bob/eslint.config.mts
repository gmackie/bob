import { defineConfig } from "eslint/config";

import { baseConfig } from "@bob/eslint-config/base";
import { reactConfig } from "@bob/eslint-config/react";

export default defineConfig(
  {
    // metro-shims holds build-time module-resolution stubs (CommonJS, no
    // tsconfig project coverage), the same category as expo-plugins. Linting
    // them fails with "not found by the project service" rather than finding
    // anything — the node:crypto stub broke `@bob/mobile#lint` on master this
    // way, which blocks every deploy because both deploy jobs are `needs: ci`.
    ignores: [".expo/**", "expo-plugins/**", "metro-shims/**"],
  },
  baseConfig,
  reactConfig,
);

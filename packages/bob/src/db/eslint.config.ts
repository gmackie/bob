import { defineConfig } from "eslint/config";

import { baseConfig } from "@bob/eslint-config/base";

export default defineConfig(
  {
    ignores: ["dist/**"],
  },
  baseConfig,
);

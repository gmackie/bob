import { defineConfig } from "eslint/config";

import { baseConfig, restrictEnvAccess } from "@bob/eslint-config/base";
import { nextjsConfig } from "@bob/eslint-config/nextjs";
import { reactConfig } from "@bob/eslint-config/react";

export default defineConfig(
  {
    ignores: [".next/**"],
  },
  baseConfig,
  reactConfig,
  nextjsConfig,
  restrictEnvAccess,
);

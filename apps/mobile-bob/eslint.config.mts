import { defineConfig } from "eslint/config";

import { baseConfig } from "@bob/eslint-config/base";
import { reactConfig } from "@bob/eslint-config/react";

export default defineConfig(
  {
    ignores: [".expo/**", "expo-plugins/**"],
  },
  baseConfig,
  reactConfig,
);

import { defineConfig } from "eslint/config";

import { baseConfig } from "@bob/eslint-config/base";

export default defineConfig(
  {
    // tsup.daemon.ts is a build-tool config file (like tsup.config.ts
    // elsewhere, which the shared *.config.* ignore already exempts) but
    // this app has multiple tsup entry configs so it can't use that exact
    // name -- exempt it the same way.
    ignores: ["dist/**", "tsup.daemon.ts"],
  },
  baseConfig,
);

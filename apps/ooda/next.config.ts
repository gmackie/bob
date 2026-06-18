import type { NextConfig } from "next";

const config: NextConfig = {
  // Workspace packages (`@gmacko/core`, `@gmacko/ooda`) follow the
  // `moduleResolution: "bundler"` convention and write intra-package imports
  // with a `.js` extension that on disk is a `.ts` file. Both Turbopack and
  // webpack default to literal-extension resolution — so absent any
  // remapping, `import "./api-keys.js"` fails with "Module not found".
  //
  // Turbopack: `resolveAlias` with a wildcard map. Each `.js` import is
  // tried as `.ts`, `.tsx`, then `.js` in order; the first that resolves
  // wins. Documented at https://nextjs.org/docs/app/api-reference/config/
  // next-config-js/turbopack#resolving-aliases.
  //
  // Webpack: `resolve.extensionAlias` is the canonical webpack 5 mechanism
  // for the same mapping. Set inside the webpack callback so it only
  // applies under the legacy webpack builder.
  turbopack: {
    resolveAlias: {
      "*.js": ["*.ts", "*.tsx", "*.js"],
    },
  },
  webpack: (cfg) => {
    cfg.resolve = cfg.resolve ?? {};
    cfg.resolve.extensionAlias = {
      ...(cfg.resolve.extensionAlias ?? {}),
      ".js": [".ts", ".tsx", ".js"],
    };
    return cfg;
  },
  transpilePackages: ["@gmacko/core", "@gmacko/ooda"],
};

export default config;

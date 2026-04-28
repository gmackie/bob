import type { NextConfig } from "next";

const config: NextConfig = {
  // Workspace packages (`@gmacko/auth`, `@gmacko/agent`, …) follow the
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
  // applies under the legacy webpack builder (used today by `--webpack`
  // and by Vercel's serverless runtime when Turbopack is disabled).
  turbopack: {
    resolveAlias: {
      "*.js": ["*.ts", "*.tsx", "*.js"],
    },
  },
  // `serverExternalPackages` tells Next.js NOT to bundle these for server
  // components — they're loaded via Node's native `require` at runtime.
  // Without this, Next still tree-walks through `@gmacko/db` and friends
  // when building the SSR bundle, which can surface `node:fs` / `node:path` /
  // `node:url` UnhandledSchemeError on the server side. Required for SSR
  // because the pglite migrator and drizzle-orm reach native modules.
  serverExternalPackages: [
    "@electric-sql/pglite",
    "postgres",
    "pg",
    "drizzle-orm",
  ],
  webpack: (cfg) => {
    // `cfg` is webpack's `Configuration` type — kept loosely typed here
    // because pulling `webpack` into `apps/web`'s direct deps just for the
    // type isn't worth it (Next.js owns the webpack install).
    cfg.resolve = cfg.resolve ?? {};
    cfg.resolve.extensionAlias = {
      ...(cfg.resolve.extensionAlias ?? {}),
      ".js": [".ts", ".tsx", ".js"],
    };
    return cfg;
  },
  transpilePackages: [
    "@gmacko/agent",
    "@gmacko/app-shell",
    "@gmacko/client",
    "@gmacko/contracts",
    "@gmacko/core",
    "@gmacko/models",
    "@gmacko/realtime",
    "@gmacko/rpc",
    "@gmacko/runner-base",
    "@gmacko/runner-protocol",
    "@gmacko/ui",
  ],
  async rewrites() {
    return [
      {
        source: "/rpc",
        destination: "http://localhost:3001/rpc",
      },
      {
        source: "/api/chat/stream",
        destination: "http://localhost:3001/api/chat/stream",
      },
    ];
  },
};

export default config;

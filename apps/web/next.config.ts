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
  // when building the SSR bundle, which surfaces the same `node:fs` /
  // `node:path` / `node:url` UnhandledSchemeError on the server side.
  // Combined with `resolve.fallback` (in the webpack callback below) for
  // the client bundle, the dual-axis fix clears the blocker that comes
  // from `@gmacko/auth` / `@gmacko/db` / drizzle-orm's pglite migrator.
  serverExternalPackages: [
    "@electric-sql/pglite",
    "postgres",
    "pg",
    "drizzle-orm",
  ],
  webpack: (cfg, { isServer, webpack }) => {
    // `cfg` is webpack's `Configuration` type — kept loosely typed here
    // because pulling `webpack` into `apps/web`'s direct deps just for the
    // type isn't worth it (Next.js owns the webpack install).
    cfg.resolve = cfg.resolve ?? {};
    cfg.resolve.extensionAlias = {
      ...(cfg.resolve.extensionAlias ?? {}),
      ".js": [".ts", ".tsx", ".js"],
    };
    if (!isServer) {
      // The `@gmacko/auth` / `@gmacko/agent` / `@gmacko/db` services import
      // Node-only modules (`node:fs`, `node:path`, `node:url`,
      // `node:crypto`, `node:child_process`, `perf_hooks`, …) at module
      // load time. The client bundle tree-walks through these via the
      // `@gmacko/contracts` tagged-error classes → `@gmacko/client` →
      // `@gmacko/app-shell`'s `RpcClientProvider` chain, even though no
      // client code actually CALLS those services at runtime.
      //
      // Two-axis fix:
      //   1. `resolve.fallback` for bare names like `fs`, `path`, …
      //      (webpack 5 default behavior maps `node:fs` to `fs`).
      //   2. `NormalModuleReplacementPlugin` for the `node:`-scheme
      //      variants — webpack's `UnhandledSchemeError` fires before
      //      `resolve.fallback` consults its map, so we strip the
      //      `node:` prefix at the resolver layer.
      // Together they neutralize the entire transitive Node-built-in
      // surface for the client bundle.
      cfg.resolve.fallback = {
        ...(cfg.resolve.fallback ?? {}),
        fs: false,
        path: false,
        url: false,
        crypto: false,
        net: false,
        tls: false,
        dns: false,
        os: false,
        stream: false,
        http: false,
        https: false,
        zlib: false,
        child_process: false,
        worker_threads: false,
        buffer: false,
        util: false,
        events: false,
        assert: false,
        querystring: false,
        perf_hooks: false,
        // Server-only packages that should never reach the client bundle.
        "@electric-sql/pglite": false,
        postgres: false,
        pg: false,
      };
      cfg.plugins = cfg.plugins ?? [];
      // Strip the `node:` scheme so the bare-name `resolve.fallback`
      // entries above can take effect. The replacement happens in the
      // `normal` factory (i.e. before resource resolution), so webpack
      // never tries to load a `node:fs` URI directly.
      cfg.plugins.push(
        new webpack.NormalModuleReplacementPlugin(
          /^node:/,
          (resource: { request: string }) => {
            resource.request = resource.request.replace(/^node:/, "");
          },
        ),
      );
    }
    return cfg;
  },
  transpilePackages: [
    "@gmacko/agent",
    "@gmacko/app-shell",
    "@gmacko/auth",
    "@gmacko/client",
    "@gmacko/config",
    "@gmacko/contracts",
    "@gmacko/db",
    "@gmacko/models",
    "@gmacko/projects",
    "@gmacko/realtime",
    "@gmacko/rpc",
    "@gmacko/runner-base",
    "@gmacko/runner-protocol",
    "@gmacko/secrets",
    "@gmacko/ui",
    "@gmacko/validators",
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

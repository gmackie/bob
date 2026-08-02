import { defineConfig } from "tsup";
import type { Plugin } from "esbuild";
import path from "path";

const stubPglite: Plugin = {
  name: "stub-pglite",
  setup(build) {
    const stubPath = path.resolve(__dirname, "src/stubs/client-pglite.ts");
    build.onResolve({ filter: /client-pglite/ }, (args) => {
      if (args.importer.includes("packages/bob/src/db")) {
        return { path: stubPath };
      }
    });
  },
};

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node22",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  dts: false,
  // ESM output has no CommonJS `require`, so any dynamic `require()` in a bundled
  // dependency (e.g. the observability/OTel instrumentation) throws "Dynamic
  // require of X is not supported" at runtime and crash-loops the service.
  // Re-create `require` from the ESM entry so those calls resolve.
  banner: {
    js: "import { createRequire as __createRequire } from 'module'; const require = __createRequire(import.meta.url);",
  },
  noExternal: [/^@bob\//, /^@gmacko\//],
  external: [
    "@vercel/postgres",
    "mysql2",
    "mysql2/promise",
    "@planetscale/database",
    "better-sqlite3",
  ],
  esbuildPlugins: [stubPglite],
});

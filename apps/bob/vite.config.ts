import path from "node:path";
import { defineConfig } from "vite";
import vinext from "vinext";
import { cloudflare } from "@cloudflare/vite-plugin";

const target = (process.env.BOB_BUILD_TARGET ?? "cloudflare") as
  | "cloudflare"
  | "node";

// NOTE: the Effect-RPC handler (`~/server/rpc`) used to be aliased to a 501
// stub for the Cloudflare Workers build because `effect/unstable/rpc` was
// believed to be un-bundleable for Workers. That is no longer true — with
// `nodejs_compat` + the node:fs/node:os/pg-native stubs below, the real handler
// bundles and runs on workerd (verified end-to-end: ndjson dispatch + auth
// middleware return structured responses). The stub has been removed so
// `/api/rpc` is served natively at the edge. See
// docs/plans/2026-06-21-bob-effect-rpc-openapi.md.

const nodeAliases: Record<string, string> = {
  "~": path.resolve(__dirname, "src"),
};

const cloudflareAliases: Record<string, string> = {
  ...nodeAliases,
  "@bob/db/client": path.resolve(__dirname, "src/lib/db-client-lazy.ts"),
  "node:fs": path.resolve(__dirname, "src/lib/fs-stub.ts"),
  "node:os": path.resolve(__dirname, "src/lib/os-stub.ts"),
  "pg-native": path.resolve(__dirname, "src/lib/pg-native-stub.ts"),
};

export default defineConfig({
  plugins: [
    vinext(),
    cloudflare({
      viteEnvironment: {
        name: "rsc",
        childEnvironments: ["ssr"],
      },
    }),
  ],
  resolve: {
    alias: target === "node" ? nodeAliases : cloudflareAliases,
  },
  ssr: {
    noExternal: [/^@bob\//, "postgres", "drizzle-orm"],
    external: [
      "pg",
      "pg-native",
      "pg-pool",
      "@electric-sql/pglite",
      "drizzle-kit",
      "drizzle-kit/api",
    ],
  },
});

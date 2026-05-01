import path from "node:path";
import { defineConfig } from "vite";
import vinext from "vinext";
import { cloudflare } from "@cloudflare/vite-plugin";

const target = (process.env.BOB_BUILD_TARGET ?? "cloudflare") as
  | "cloudflare"
  | "node";
const isDev = process.env.NODE_ENV !== "production" && !process.env.CF_PAGES;
const useCloudflarePlugin = !isDev && target === "cloudflare";

const rpcStubPath = path.resolve(__dirname, "src/lib/rpc-stub.ts");
const rpcRealPath = path.resolve(__dirname, "src/server/rpc");

/**
 * Custom Vite plugin that redirects ~/server/rpc to the edge-safe stub
 * when building for Cloudflare Workers. This must be a plugin (not a simple
 * alias) because the `~` alias resolves first, turning `~/server/rpc` into
 * the absolute path before other aliases can match.
 */
function rpcStubPlugin() {
  return {
    name: "bob-rpc-stub",
    enforce: "pre" as const,
    resolveId(source: string) {
      // vinext resolves `~` before plugins run, so the import arrives as
      // "/src/server/rpc" rather than "~/server/rpc". Match both forms.
      if (
        source === "~/server/rpc" ||
        source === "/src/server/rpc" ||
        source.startsWith(rpcRealPath)
      ) {
        return rpcStubPath;
      }
    },
  };
}

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
    ...(target === "cloudflare" ? [rpcStubPlugin()] : []),
    vinext(),
    ...(useCloudflarePlugin
      ? [
          cloudflare({
            viteEnvironment: {
              name: "rsc",
              childEnvironments: ["ssr"],
            },
          }),
        ]
      : []),
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

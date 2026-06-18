import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import vinext from "vinext";
import { cloudflare } from "@cloudflare/vite-plugin";
import { getResolveAliases } from "./vite.aliases";

const target = (process.env.BOB_BUILD_TARGET ?? "cloudflare") as
  | "cloudflare"
  | "node";
const isDev = process.env.NODE_ENV !== "production" && !process.env.CF_PAGES;
const useCloudflarePlugin = !isDev;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
    alias: getResolveAliases(target),
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

import path from "node:path";
import { defineConfig } from "vite";
import vinext from "vinext";
import { cloudflare } from "@cloudflare/vite-plugin";

const target = (process.env.BOB_BUILD_TARGET ?? "cloudflare") as
  | "cloudflare"
  | "node";
const isDev = process.env.NODE_ENV !== "production" && !process.env.CF_PAGES;
const useCloudflarePlugin = !isDev && target === "cloudflare";

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
    external: ["pg", "pg-native", "pg-pool", "@electric-sql/pglite"],
  },
});

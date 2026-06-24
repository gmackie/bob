import path from "node:path";
import { defineConfig } from "vite";
import vinext from "vinext";
import { cloudflare } from "@cloudflare/vite-plugin";

const target = (process.env.BOB_BUILD_TARGET ?? "cloudflare") as
  | "cloudflare"
  | "node";
const rpcStubPath = path.resolve(__dirname, "lib/rpc-stub.ts");
const rpcRealPath = path.resolve(__dirname, "server/rpc");

function rpcStubPlugin() {
  return {
    name: "bob-rpc-stub",
    enforce: "pre" as const,
    resolveId(source: string) {
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
  "~": path.resolve(__dirname),
};

const cloudflareAliases: Record<string, string> = {
  ...nodeAliases,
  "@bob/db/client": path.resolve(__dirname, "lib/db-client-lazy.ts"),
  "node:fs": path.resolve(__dirname, "lib/fs-stub.ts"),
  "node:os": path.resolve(__dirname, "lib/os-stub.ts"),
  "pg-native": path.resolve(__dirname, "lib/pg-native-stub.ts"),
};

export default defineConfig({
  plugins: [
    rpcStubPlugin(),
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

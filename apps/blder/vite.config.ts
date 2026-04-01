import path from "node:path";
import { defineConfig } from "vite";
import vinext from "vinext";
import { cloudflare } from "@cloudflare/vite-plugin";

const isDev = process.env.NODE_ENV !== "production" && !process.env.CF_PAGES;

export default defineConfig({
  plugins: [
    vinext(),
    ...(!isDev
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
    preserveSymlinks: true,
    alias: {
      "~": path.resolve(__dirname, "src"),
      "@bob/db/client": path.resolve(__dirname, "src/lib/db-client-lazy.ts"),
      "node:fs": path.resolve(__dirname, "src/lib/fs-stub.ts"),
      "node:os": path.resolve(__dirname, "src/lib/os-stub.ts"),
      "pg-native": path.resolve(__dirname, "src/lib/pg-native-stub.ts"),
    },
  },
  ssr: {
    noExternal: [/^@bob\//, "postgres", "drizzle-orm"],
    external: ["pg", "pg-native", "pg-pool"],
  },
});

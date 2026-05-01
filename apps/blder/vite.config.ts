import path from "node:path";
import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";
import vinext from "vinext";

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
    alias: {
      "~": path.resolve(__dirname, "src"),
      "node:fs": path.resolve(__dirname, "src/lib/fs-stub.ts"),
      "node:os": path.resolve(__dirname, "src/lib/os-stub.ts"),
      "pg-native": path.resolve(__dirname, "src/lib/pg-native-stub.ts"),
    },
  },
  ssr: {
    noExternal: ["postgres", "drizzle-orm", /^@gmacko\//],
    external: ["pg", "pg-native", "pg-pool", "@electric-sql/pglite"],
  },
});

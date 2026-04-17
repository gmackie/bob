import { defineConfig } from "tsdown";

const shared = {
  format: "cjs" as const,
  outDir: "dist-electron",
  sourcemap: true,
  target: "node22",
  platform: "node" as const,
  external: ["electron"],
  dts: false,
  outExtensions: () => ({ js: ".js" }),
};

export default defineConfig([
  {
    ...shared,
    entry: ["src/main.ts"],
    clean: true,
  },
  {
    ...shared,
    entry: ["src/preload.ts"],
  },
]);

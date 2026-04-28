import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node22",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  dts: false,
  // Inline workspace packages so `node dist/index.js` works without a
  // separate build step for @bob/db. Real npm deps (drizzle-orm, pg,
  // ws, etc.) stay external because they're already in package.json.
  noExternal: [/^@bob\//],
});

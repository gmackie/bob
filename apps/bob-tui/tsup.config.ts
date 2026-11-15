import { defineConfig } from "tsup";

// @bob/sdlc-view ships TypeScript source, so it is bundled; ink, react and ws stay
// runtime dependencies resolved from node_modules.
export default defineConfig({
  entry: ["src/cli.tsx"],
  format: ["esm"],
  target: "node22",
  platform: "node",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  dts: false,
  noExternal: [/^@bob\//],
  banner: { js: "#!/usr/bin/env node" },
});

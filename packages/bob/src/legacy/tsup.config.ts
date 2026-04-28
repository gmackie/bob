import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "agents/index": "src/agents/index.ts",
    "services/index": "src/services/index.ts",
  },
  format: ["esm"],
  dts: true,
  outDir: "dist",
  clean: true,
  external: ["node-pty", "ws"],
});

import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/daemon/index.ts"],
  format: ["esm"],
  platform: "node",
  target: "node20",
  outDir: "dist/daemon",
  clean: true,
  external: [
    "ws",
    /^@opentelemetry\//,
  ],
  noExternal: [/@bob\/telemetry/],
});

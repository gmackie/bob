import { defineConfig } from "tsup";

export default defineConfig({
  // Object form pins the output names. A bare array would re-root the paths
  // to dist/daemon/daemon/index.js the moment a second entry is added, which
  // silently breaks both the deploy script and the systemd ExecStart.
  entry: {
    index: "src/daemon/index.ts",
    "agent-health": "src/agent-health-cli.ts",
  },
  format: ["esm"],
  platform: "node",
  removeNodeProtocol: false,
  target: "node24",
  outDir: "dist/daemon",
  clean: true,
  external: [
    "ws",
    "@trpc/client",
    "superjson",
    "@sentry/node",
    "posthog-node",
    /^@opentelemetry\//,
  ],
  noExternal: [/@gmacko\/core/, /^@bob\/(observability|telemetry)/],
});

// Injected into the CJS telemetry-node bundle (esbuild `inject` + `define`).
// OpenTelemetry 0.30x ships rolldown-built ESM that calls
// createRequire(import.meta.url); esbuild leaves import.meta empty in CJS
// output, so give it this file's real URL instead.
// oxlint-disable-next-line no-undef -- `require` and `__filename` exist in the CJS bundle.
export const importMetaUrl = require("node:url").pathToFileURL(__filename).href;

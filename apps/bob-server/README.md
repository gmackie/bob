# @bob/server

Local Node.js wrapper around `@bob/blder` for desktop-shell packaging. Spawns
blder as a child process on a random internal port and exposes an auth-gated
reverse proxy on the requested external port.

## Usage

```
pnpm --filter @bob/server start --port 0 --no-browser
```

On `ready`, a single JSON line is emitted to stdout:

```json
{"ready":true,"url":"http://127.0.0.1:52942","authToken":"…"}
```

Flags:

- `--port <n>` — external bind port, `0` picks a random free port (default: `0`)
- `--host <addr>` — bind address (default: `127.0.0.1`; any non-loopback host requires `--auth-token` or `--bootstrap-fd`)
- `--auth-token <t>` — bearer token required on every request
- `--bootstrap-fd <fd>` — read a JSON `{"authToken":"…"}` envelope from an inherited pipe FD
- `--base-dir <path>` — persistence root (default: `~/.bob`)
- `--no-browser` — skip auto-open of the UI

If neither `--auth-token` nor `--bootstrap-fd` is provided, a random 32-byte
token is generated and printed in the ready line.

## Build-time caveats

1. **Build the Node app first.** `pnpm --filter @bob/desktop stage` builds a
   separate Node app and stages production dependencies, bob-server, and migrations.
   Development can use `BOB_DESKTOP_DEV=1` with the workspace Vinext CLI.
2. **Direct bundled runtime.** bob-server invokes Vinext's HTTP adapter directly
   using `process.execPath`; production output exports a handler and must not be
   executed as a standalone listening server. No package manager runs at startup.
   Electron supplies its own executable with `ELECTRON_RUN_AS_NODE=1`, pins
   `BOB_NODE` to that executable, and overrides development/old-install paths.
3. **Packaged resources.** Paths come from the current Electron `resourcesPath`,
   including migrations. Staging writes `runtime-resources.json` with checksums
   for launch modules, built server/client assets, and SQL migrations. Local packaged startup
   checks it before spawning and reports a missing/corrupt resource with reinstall
   guidance. This detects accidental damage; platform code signing remains the
   authenticity boundary. See `apps/desktop-bob/PACKAGING.md` for validation.

## Architecture

```
  external:auth-gated HTTP  ←→  internal:random port (vinext/blder)
               │                             │
       createHttpServer()              spawn(process.execPath, [vinext cli, "start", ...])
```

Auth presents as either `Authorization: Bearer <token>` or `?t=<token>` query
parameter — the latter is for the initial browser navigation before headers
can be attached by the page.

## Dev mode

When `BOB_DESKTOP_DEV=1`, bob-server spawns vinext `dev` instead of the production
HTTP adapter so HMR works.

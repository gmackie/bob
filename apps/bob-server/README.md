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

1. **blder must be built first.** `pnpm --filter @bob/server start` spawns
   `pnpm --filter @bob/blder start` which runs `vinext start` against
   `apps/blder/dist/`. Run `pnpm --filter @bob/blder build` (with
   `BOB_BUILD_TARGET=node`) before starting bob-server for the first time.
2. **wrangler.jsonc workaround (Phase 1).** To build blder with
   `BOB_BUILD_TARGET=node`, `apps/blder/wrangler.jsonc` must be temporarily
   renamed during build. This is a build-time workaround — bob-server itself
   does not need to touch it because it spawns against an already-built dist.
3. **PGlite migrations.** bob-server injects `BOB_DB_MIGRATIONS_DIR` pointing
   at `packages/db/drizzle/` so PGlite bootstrap resolves migrations even when
   spawned from a different cwd. Computed at runtime from the compiled
   `server.js` location.
4. **pnpm at runtime.** Task 6 spawns via the `pnpm` binary. This is fine for
   dev and CI but will not survive Electron packaging (no `pnpm` in a DMG).
   Phase 4 replaces with a direct `node dist/server/entry.js` invocation.

## Architecture

```
  external:auth-gated HTTP  ←→  internal:random port (vinext/blder)
               │                             │
       createHttpServer()              spawn("pnpm",["--filter","@bob/blder","start"])
```

Auth presents as either `Authorization: Bearer <token>` or `?t=<token>` query
parameter — the latter is for the initial browser navigation before headers
can be attached by the page.

## Dev mode

When `BOB_DESKTOP_DEV=1`, bob-server will spawn `pnpm --filter @bob/blder dev`
instead of `start` so that vinext HMR works. (Task 13 — not yet enabled.)

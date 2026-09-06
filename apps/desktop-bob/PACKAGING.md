# Bob Desktop — Packaging

`@bob/desktop` has two explicit modes. Local mode opens its own PGlite-backed
app with ordinary BetterAuth local email/password accounts. Host execution is unavailable there:
there is no local WebSocket relay sharing that database. Connected mode opens a
configured remote Bob app and runs the bundled Go daemon against that same
app's API and configured gateway. Local records are never presented as remotely
executable work.

## What ships today

- **electron-builder pipeline** — `electron-builder.yml`, `pnpm package`, staging
  via `scripts/stage-packaging.mjs`.
- **Packaged-mode paths** — `src/packaging.ts` resolves `bob-server`, daemon
  binaries, and DB migrations from `process.resourcesPath` when `app.isPackaged`.
- **No runtime pnpm** — `@bob/server` spawns blder via `node` + vinext CLI or
  its production HTTP adapter (`vinext start`); emitted `dist/server` entries are handlers, not executable servers; the desktop shell spawns bob-server with
  `process.execPath` + `ELECTRON_RUN_AS_NODE=1`.
- **Cross-platform daemon strategy** — `bob-<os>-<arch>` naming for
  darwin/linux/windows; missing binaries block connected execution with a visible diagnostic. Rebuild via
  `pnpm build:daemon` (requires Go + `github.com/blder/bob`).
- **Signing / notarization** — macOS hardened runtime + entitlements; notarize via
  `APPLE_TEAM_ID` plus either Apple ID credentials or App Store Connect API key env
  vars (see below).

## Build a release

```bash
# 1. Build workspace payloads the desktop bundles
pnpm --filter @bob/desktop build:app
pnpm --filter @bob/server build

# 2. (Optional) refresh Go daemon binaries
cd apps/desktop-bob && pnpm build:daemon

# 3. Package (stages resources, builds Electron main/preload, runs electron-builder)
cd apps/desktop-bob && pnpm package
```

Artifacts land in `apps/desktop-bob/release/`.

## macOS signing / notarization env

Set these before `pnpm package` on a Mac with a Developer ID certificate installed:

| Variable | Purpose |
| --- | --- |
| `CSC_NAME` or `CSC_LINK` + `CSC_KEY_PASSWORD` | Code-sign the `.app` |
| `APPLE_TEAM_ID` | Team ID wired into `electron-builder.yml` |
| `APPLE_ID` + `APPLE_APP_SPECIFIC_PASSWORD` | Apple ID notarization |
| `APPLE_API_KEY` + `APPLE_API_KEY_ID` + `APPLE_API_ISSUER` | ASC API key notarization (alternative) |

For unsigned macOS acceptance, explicitly disable signing and notarization in a
separate builder configuration (`mac.identity: null`, `mac.notarize: false`) and
use `--dir`. This does not provide a distributable notarized release.

## Layout inside the packaged app

```
Contents/Resources/
  bob-server/     # pnpm deploy of @bob/server
  blder/          # pnpm deploy of @bob/blder (vinext dist + runtime deps)
  db-migrations/  # packages/bob/src/db/drizzle
  bin/            # Go daemon binaries (bob-darwin-*, bob-linux-*, bob-windows-*.exe)
```

## Dev mode

```bash
cd apps/desktop-bob && pnpm dev
```

Spawns against the monorepo layout (not `resourcesPath`). For production-mode
`pnpm start`, first run `pnpm build:app`; it uses `.node-app` (or `BOB_NODE_APP_DIR`). Set `BOB_DESKTOP_DEV=1`
(via `dev-electron.mjs`) to run vinext HMR instead of the production server entry.

## Connection and filesystem settings

Without connected settings, the desktop starts in local mode and displays an
execution-unavailable message. The bootstrap token travels through an inherited
pipe, is exchanged for a private HttpOnly browser cookie, and is omitted from
ready-line logs and upstream requests. BetterAuth login remains required for
application data. Local mode offers email/password account creation without
requiring hosted OAuth credentials. Accounts are private to the installation;
no remote identity is imported. The installation stores an independent random
auth secret in `userdata/auth-secret` with mode 0600, retained across restarts.
Local auth is enabled only by explicit local launch, PGlite, and a loopback HTTP
origin. Local cookies are host-only; hosted auth configuration is unchanged. The local server rejects WebSocket upgrades rather than
advertising a nonexistent `/sessions` relay.

Connected mode requires all of these settings before starting Electron:

| Setting | Meaning |
| --- | --- |
| `BOB_DESKTOP_APP_URL` | Bob app origin, for example `https://bob.example.com`; the daemon API is this origin plus `/api` |
| `BOB_DESKTOP_GATEWAY_URL` | That deployment's WebSocket relay URL, normally `wss://ws.example.com/sessions` |
| `BOB_DESKTOP_API_KEY` | API key with read/write permissions for the workspace owner |
| `BOB_DESKTOP_WORKSPACE_ID` | Existing workspace owned by that credential's principal |
| `BOB_DESKTOP_USER_ID` | Expected owner identity, checked against both the API and gateway |
| `BOB_DESKTOP_DEV_DIR` | Explicit directory scanned by the foreground daemon |

Sign in to the connected app as the configured owner and select its configured
workspace. Connected mode uses normal persistent browser authentication for
that app origin. A read-only API/workspace check and browser WebSocket hello
verify the credential and principal without replacing an active daemon during
preflight. The real foreground daemon then takes the configured workspace's host
connection. Its confirmed gateway connection is required before the desktop
reports connected execution. Invalid or incomplete settings display an error;
they never fall back to sending local-database tasks to a remote daemon.

The bundled CLI starts as `bob start <devDir> --config <private-launch-config>`.
The private config contains the workspace/directory, while the API key is passed
in the child environment. This leaves the user's global Bob daemon config and
PID lane untouched. Electron owns the process group and removes its temporary
config on shutdown. Shutdown waits for process-group disappearance and escalates
to SIGKILL even when the group leader has already exited. The local upstream's
separate process group is tracked as well.

Local filesystem access is disabled by default. To authorize specific local
roots, set `BOB_DESKTOP_FILESYSTEM_ROOTS` to a JSON array of absolute directories.
The CLI equivalent is repeatable `bob-server --filesystem-root <directory>`.
Only authenticated local-proxy requests can receive this capability, and it is
bound to the actual signed-in user. Hosted and connected-remote API handlers do
not gain filesystem authority from these desktop settings. Sources and
destinations must remain within configured canonical roots; symlinks are not
traversed. This is a trusted local-operator boundary, not an OS sandbox against
concurrent filesystem changes by other processes running as that operator.

## Focused verification

`pnpm --filter @bob/server test` runs actual loopback proxy/bootstrap tests with
a controlled upstream plus real process-tree termination tests. It does not
require a prebuilt app or touch an existing database.

`pnpm --filter @bob/desktop test` tests connected configuration and real HTTP/WS
fixtures. On macOS it also runs the matching bundled Go binary against an empty
temporary directory and loopback API/gateway, confirming a UI-created session is
claimed by that peer. No installed provider or remote credentials are used.
These checks do not replace signed-in Electron visual acceptance, a packaged
PGlite migration smoke test, or a real-provider task run.


## Portable Node build and acceptance

Staging builds a separate Node app root because Vinext treats the presence of
`wrangler.jsonc` as a Worker build requirement. It preserves the normal Worker
output and serves the Node output with Vinext's HTTP/static/RSC adapter. The
Node runtime directly declares its external PostgreSQL, PGlite and drizzle-kit
dependencies. `stage` performs both Node app and bob-server builds before copying.

For large builds, set `BOB_NODE_APP_DIR` and `BOB_PACKAGING_DIR` to dedicated
external-volume directories. The default paths are `.node-app` and `.packaging`
under this app. Electron-builder's default resource config uses `.packaging`.

Set `BOB_DESKTOP_DATA_DIR` to an absolute isolated directory for acceptance. It
separates browser profile, local database, auth secret and logs from the user's
installation. Without it the existing `~/.bob` backend data location is preserved.

Run `BOB_PACKAGING_DIR=<resources> node scripts/verify-local-runtime.mjs` to verify
fresh PGlite bootstrap, normal local signup/login, authenticated settings, session
creation, account isolation and persistence after a real server restart. This
always creates and removes a new fixture directory; it never reuses user data.

Run the same check against the final `.app/Contents/Resources` directory after
packaging as well. electron-builder skips a mapping-root `node_modules` directory;
our resource mapping starts at the staging parent so runtime dependencies remain
nested and are copied. A staging-only test cannot catch this packaging failure.
For bundled-runtime parity, set `ELECTRON_RUN_AS_NODE=1` and use the app's executable
to run `verify-local-runtime.mjs` with that final resources directory.

Startup readiness remains an actual HTTP check. On slow test/operator hosts,
`BOB_SERVER_STARTUP_TIMEOUT_MS` can raise its default 30-second deadline, bounded
to 1–300 seconds; the desktop supervisor automatically allows five more seconds.
Acceptance on a heavily swapped host uses `300000`, without weakening login,
readiness, persistence or isolation assertions. Permission-denied existence probes
remain "process exists"; failed termination signals still fail explicitly, and a
cleanup failure no longer hides the original startup error.

Local desktop browser sessions use a persistent, local-only Electron partition inside
its userData directory. Connected origins have distinct persistent partitions.
Page navigation cannot overwrite the supervisor title. The server-derived local
capability marks host execution unavailable in the shell and prevents gateway
transport construction; hosted/connected gateway behavior is unchanged.

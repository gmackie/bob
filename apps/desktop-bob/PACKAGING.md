# Bob Desktop — Packaging

`@bob/desktop` is a self-contained local-first Electron app: it spawns a local
`bob-server` (PGlite-backed) + a bundled Go daemon and loads the local server in a
webview.

## What ships today

- **electron-builder pipeline** — `electron-builder.yml`, `pnpm package`, staging
  via `scripts/stage-packaging.mjs`.
- **Packaged-mode paths** — `src/packaging.ts` resolves `bob-server`, daemon
  binaries, and DB migrations from `process.resourcesPath` when `app.isPackaged`.
- **No runtime pnpm** — `@bob/server` spawns blder via `node` + vinext CLI or
  `dist/server/{index,entry}.js`; the desktop shell spawns bob-server with
  `process.execPath` + `ELECTRON_RUN_AS_NODE=1`.
- **Cross-platform daemon strategy** — `bob-<os>-<arch>` naming for
  darwin/linux/windows; missing binaries are skipped with a warning. Rebuild via
  `pnpm build:daemon` (requires Go + `github.com/blder/bob`).
- **Signing / notarization** — macOS hardened runtime + entitlements; notarize via
  `APPLE_TEAM_ID` plus either Apple ID credentials or App Store Connect API key env
  vars (see below).

## Build a release

```bash
# 1. Build workspace payloads the desktop bundles
pnpm --filter @bob/blder build
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

Without credentials, `electron-builder` still produces an unsigned build (useful for
layout validation on CI/Linux).

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

Spawns against the monorepo layout (not `resourcesPath`). Set `BOB_DESKTOP_DEV=1`
(via `dev-electron.mjs`) to run vinext HMR instead of the production server entry.

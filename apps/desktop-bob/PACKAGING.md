# Bob Desktop — Packaging Plan

`@bob/desktop` is a **self-contained local-first Electron app**: it spawns a local
`bob-server` (PGlite-backed) + a bundled Go daemon and loads the local server in a
webview. It runs in dev today but has **never been packaged** — there's no
electron-builder pipeline. This is the concrete plan to a shippable signed build.

## Current state (verified)
- `pnpm build` (tsdown) passes → `dist-electron/main.js` + `preload.js`.
- Go daemon binaries are present + git-tracked: `resources/bin/bob-darwin-arm64`
  (10.0 MB), `bob-darwin-amd64` (10.7 MB) — real Mach-O, but **stale committed
  blobs** (Apr 29) with no rebuild path; **macOS-only** (`resolveDaemonBinaryPath`
  returns null off-darwin, `src/main.ts:139-149`).
- `spawnBobServer()` (`src/main.ts:63-137`) runs `node apps/bob-server/dist/bin.js
  --port 0 --host 127.0.0.1 --auth-token <rand>`; DB is **PGlite** local WASM
  (`apps/bob-server/src/server.ts:43,59-60`, `~/.bob/userdata/db`).

## Gaps blocking a packaged release
1. **No electron-builder pipeline.** `package.json` `build` is just
   `{appId, productName}`; electron-builder isn't even a devDep; no `dist`/`make`
   script; no `electron-builder.yml`.
2. **Packaged paths break.** `APP_ROOT = path.resolve(__dirname, "../../..")`
   (`src/main.ts:11`) and `BOB_SERVER_BIN` (`:46-52`) assume the monorepo layout;
   inside `app.asar` (`Contents/Resources/app.asar/dist-electron/main.js`),
   `../../..` is wrong and `apps/bob-server` won't exist. `DAEMON_BIN_DIR` (`:55`)
   same issue unless shipped via `extraResources`.
3. **bob-server not bundled.** Nothing copies `apps/bob-server/dist` + its runtime
   deps (`@bob/blder`, `@bob/db`, the PGlite WASM) into the package.
4. **Spawns a system `node`** (`src/main.ts:65-66`) that won't exist on user
   machines — must use `process.execPath` + `ELECTRON_RUN_AS_NODE=1` (or `fork`).
5. **No code-signing / notarization** (no identity, hardenedRuntime, entitlements,
   notarize) — a child-process-spawning app will be Gatekeeper-blocked otherwise.
6. **Daemon is a committed blob**, no Go cross-compile step; source is external
   (`github.com/blder/bob`); no Linux/Windows daemon.
7. **No app icon / DMG assets.**

## Plan (ordered)
1. **electron-builder setup** — add it as a devDep; add `package`/`dist` scripts;
   add `electron-builder.yml` with `mac` (dmg, arm64+x64), `directories.buildResources`,
   an app icon (`build/icon.icns`), and `extraResources` copying
   `apps/bob-server/dist` (+ pruned `node_modules` incl. PGlite WASM) → `bob-server/`
   and `resources/bin/` → `bin/`.
2. **Packaged-mode path resolution** — branch on `app.isPackaged`: resolve
   `BOB_SERVER_BIN` and `DAEMON_BIN_DIR` from `process.resourcesPath` in packaged
   mode, keep `../../..` for dev. (Must match the `extraResources` layout from step 1.)
3. **Node spawn** — replace `spawn("node", …)` with `spawn(process.execPath, …, {
   env: { ELECTRON_RUN_AS_NODE: "1", … } })`.
4. **Daemon build** — script the Go cross-compile (`GOOS`/`GOARCH`) of the external
   `github.com/blder/bob` CLI → `resources/bin/bob-<os>-<arch>`, so the binary is
   reproducible, not a stale blob; add Linux/Windows if those targets are wanted.
5. **Signing/notarization** — Developer ID identity, `hardenedRuntime: true`, an
   entitlements plist (JIT / inherit / network), and `notarize` (Apple ID or
   App Store Connect API key) — wired into CI or a local `eas`-style step.
6. **Verify** — package, then confirm the app boots end-to-end: server spawn →
   PGlite init → daemon spawn → `loadURL`.

## Credential / environment gates (why this needs a dedicated Mac session)
Steps 2-4 are pure code; **steps 1, 5, 6 need a macOS machine + an Apple Developer
ID + a real `electron-builder` package run to validate** (the path code in step 2
must match the actual bundled layout, which only a test package confirms). That
test-build-sign loop can't be done from a headless/non-Mac context, so it's split
out here as the explicit next deliverable.

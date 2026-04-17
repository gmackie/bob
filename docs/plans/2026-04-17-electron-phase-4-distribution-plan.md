# Electron Phase 4 — Distribution Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship Bob as a signed, notarized universal macOS DMG with auto-update. A fresh Mac can install it, launch it, create a workspace, run an agent, and get auto-updated when a new release is published.

**Architecture:** `electron-builder` produces a universal DMG (arm64 + x64). Developer ID Application signing + notarytool notarization run in CI. `electron-updater` checks GitHub Releases on startup + every 4 hours. Release artifacts published via GitHub Actions on tag push.

**Tech Stack:** electron-builder, electron-updater (already in t3code reference), GitHub Actions, Apple notarytool, a Developer ID Application certificate.

**Depends on:** Phase 3 shipped (connection manager works, app is usable with both local + remote).

**Reference:** `/Volumes/dev/t3code/apps/desktop/src/updateMachine.ts` + `updateState.ts` for the auto-update state machine pattern (copy and adapt).

**Scope:**
- electron-builder config
- Universal DMG (arm64 + x64 in one installer)
- Icons + branding assets
- Developer ID signing + notarization
- electron-updater wired to GitHub Releases
- In-app update UX (check, download progress, install prompt)
- GitHub Actions release workflow
- Clean-Mac smoke test

**Out of scope:**
- Mac App Store distribution (MAS has sandbox requirements incompatible with bob-server's subprocess spawning)
- Homebrew Cask
- Sparkle-based updater (electron-updater is fine)
- Windows / Linux DMGs
- Telemetry / crash reporting (can be added post-launch)

---

## Prerequisites

1. Phase 3 done-criteria checked
2. Apple Developer Program membership (~$99/yr) — account active
3. **Developer ID Application** certificate + private key in macOS Keychain (via Xcode → Preferences → Accounts → Manage Certificates)
4. **App Store Connect API key** for notarytool (create at App Store Connect → Users and Access → Integrations → App Store Connect API). Download the `.p8` private key + note Issuer ID + Key ID
5. GitHub repo secrets:
   - `APPLE_ID` — your Apple ID email
   - `APPLE_APP_SPECIFIC_PASSWORD` — generate at appleid.apple.com
   - `APPLE_TEAM_ID` — from your Developer Program account
   - `APPLE_API_KEY_P8` — contents of the .p8 file
   - `APPLE_API_KEY_ID` — the Key ID
   - `APPLE_API_KEY_ISSUER` — the Issuer UUID
   - `CSC_LINK` — base64-encoded .p12 export of the Developer ID cert
   - `CSC_KEY_PASSWORD` — password for the .p12
6. macOS runner available in GitHub Actions (macos-14 or newer for Apple Silicon support)

---

## Task 1: Bob branding assets

**Files:**
- Create: `apps/desktop/resources/icon.icns` (macOS icon, 1024×1024 source)
- Create: `apps/desktop/resources/icon.png` (1024×1024, used at build time)
- Create: `apps/desktop/resources/background.tiff` (DMG background, 540×380 for Retina)
- Create: `apps/desktop/resources/entitlements.mac.plist`

**entitlements.mac.plist** (minimum viable):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTD/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.cs.allow-jit</key>
  <true/>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
  <true/>
  <key>com.apple.security.cs.disable-library-validation</key>
  <true/>
  <key>com.apple.security.cs.allow-dyld-environment-variables</key>
  <true/>
  <key>com.apple.security.network.client</key>
  <true/>
  <key>com.apple.security.network.server</key>
  <true/>
  <key>com.apple.security.files.user-selected.read-write</key>
  <true/>
</dict>
</plist>
```

`allow-jit` + `allow-unsigned-executable-memory` are required because PGlite's WASM runtime JITs. `network.server` is required because bob-server listens.

**Icons**: generate from a 1024×1024 source PNG using `iconutil`:

```bash
mkdir icon.iconset
# (generate the 9 sizes Apple requires — use a script or Figma export)
iconutil -c icns icon.iconset -o apps/desktop/resources/icon.icns
```

Commit: `feat(desktop): branding assets for DMG`

---

## Task 2: electron-builder config

**Files:**
- Modify: `apps/desktop/package.json` (add `build` key)
- Create: `apps/desktop/electron-builder.yml` (for complex parts)
- Add dep: `electron-builder` as devDependency
- Add script: `"dist": "electron-builder --mac"` in package.json

**electron-builder.yml:**

```yaml
appId: bot.blder.desktop
productName: Bob
copyright: "© 2026 gmacko"
directories:
  output: dist-installer
  buildResources: resources
files:
  - dist-electron/**/*
  - resources/bin/**/*
  - package.json
# bob-server and blder live in sibling workspace packages; include them via extraResources
extraResources:
  - from: "../bob-server/dist"
    to: "bob-server"
  - from: "../blder/dist"
    to: "blder"
  - from: "../../packages/db/drizzle"
    to: "db-migrations"
  - from: "resources/bin"
    to: "bin"
mac:
  category: public.app-category.developer-tools
  target:
    - target: dmg
      arch:
        - universal
  hardenedRuntime: true
  gatekeeperAssess: false
  entitlements: resources/entitlements.mac.plist
  entitlementsInherit: resources/entitlements.mac.plist
  notarize: true
  icon: resources/icon.icns
dmg:
  background: resources/background.tiff
  icon: resources/icon.icns
  iconSize: 100
  contents:
    - x: 380
      y: 200
      type: link
      path: /Applications
    - x: 120
      y: 200
      type: file
  window:
    width: 540
    height: 380
publish:
  - provider: github
    owner: <org-or-user>
    repo: bob
    releaseType: release
```

**Key decisions:**
- `universal` builds one DMG that runs natively on both arm64 and x64
- `extraResources` bundles everything the packaged app needs: built bob-server, built blder, migrations, Go daemon binary
- `publish` points at the GitHub repo that hosts releases

**Production path adjustments needed in `apps/bob-server/src/server.ts`:**
The Task 6 / Phase 2 code spawns `pnpm --filter @bob/blder start`. That doesn't work inside a packaged DMG (no pnpm, no workspace). Detect packaged mode:

```typescript
const isPackaged = typeof process.versions.electron !== "undefined";  // or pass via env
if (process.env.BOB_PACKAGED === "1") {
  // spawn node directly against packaged blder entry
  const blderEntry = path.join(process.resourcesPath, "blder/server/entry.js");
  child = spawn("node", [blderEntry], { env: { PORT: ..., ... } });
}
```

Electron main sets `BOB_PACKAGED=1` when `app.isPackaged` is true.

Commit: `feat(desktop): electron-builder config`

---

## Task 3: Packaged-mode bob-server spawn

**Files:**
- Modify: `apps/bob-server/src/server.ts`
- Modify: `apps/desktop/src/main.ts`

**Main.ts:**

```typescript
const env = {
  ...process.env,
  BOB_PACKAGED: app.isPackaged ? "1" : "0",
  BOB_RESOURCES_DIR: process.resourcesPath,
};
// passed to spawn(bob-server, ...)
```

**Bob-server server.ts:** branch based on `BOB_PACKAGED` / `BOB_RESOURCES_DIR`.

Add an integration test that runs bob-server with `BOB_PACKAGED=1` pointing at a fixture `blder/server/entry.js` → verifies startup.

Commit: `feat(server): packaged-mode blder spawn path`

---

## Task 4: electron-updater scaffold

**Files:**
- Add dep: `electron-updater` as dependency on `apps/desktop`
- Create: `apps/desktop/src/updateMachine.ts` (copy + adapt from `/Volumes/dev/t3code/apps/desktop/src/updateMachine.ts`)
- Create: `apps/desktop/src/updateState.ts` (ditto)
- Modify: `apps/desktop/src/main.ts` — wire update machine + IPC channels

**Copy from t3code, but:**
- Change channel names from `desktop:update-*` to `bob:update-*`
- Change download source in publish config to Bob's GitHub Releases
- Simplify: drop any t3code-specific state reducers you don't need

**IPC channels:**
- `bob:update-get-state` → returns current state (idle / checking / downloading / ready-to-install / error)
- `bob:update-check` → trigger manual check
- `bob:update-download` → start download after user confirms
- `bob:update-install` → quit + relaunch to apply
- `bob:update-state` → broadcast channel for state changes

Commit: `feat(desktop): update machine + IPC (adapted from t3code)`

---

## Task 5: In-app update UX

**Files:**
- Create: `apps/blder/src/components/update-toast.tsx`
- Modify: `apps/blder/src/app/layout.tsx` (mount toast)

**UX:**
- Silent check on launch + every 4 hours
- When an update is available, show a small toast: "Bob v0.2.0 is ready to download" + [Download] button
- Download shows a progress bar
- When download completes, toast changes to "Update ready — restart to install" + [Restart] button
- Errors shown inline but non-blocking

Test: mock `window.bob.update` → verify UI for each state.

Commit: `feat(blder): update toast UI`

---

## Task 6: GitHub Actions release workflow

**Files:**
- Create: `.github/workflows/desktop-release.yml`

```yaml
name: Desktop release
on:
  push:
    tags:
      - "desktop-v*"

jobs:
  build:
    runs-on: macos-14
    steps:
      - uses: actions/checkout@v4
        with:
          lfs: true
      - uses: pnpm/action-setup@v4
        with:
          version: 10.19.0
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: BOB_BUILD_TARGET=node pnpm --filter @bob/blder build
      - run: pnpm --filter @bob/server build
      - run: pnpm --filter @bob/desktop build
      - name: Build + sign + notarize + publish
        env:
          CSC_LINK: ${{ secrets.CSC_LINK }}
          CSC_KEY_PASSWORD: ${{ secrets.CSC_KEY_PASSWORD }}
          APPLE_ID: ${{ secrets.APPLE_ID }}
          APPLE_APP_SPECIFIC_PASSWORD: ${{ secrets.APPLE_APP_SPECIFIC_PASSWORD }}
          APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
          APPLE_API_KEY: ${{ secrets.APPLE_API_KEY_P8 }}
          APPLE_API_KEY_ID: ${{ secrets.APPLE_API_KEY_ID }}
          APPLE_API_ISSUER: ${{ secrets.APPLE_API_KEY_ISSUER }}
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: pnpm --filter @bob/desktop dist --publish always
```

Tag pattern `desktop-v*` keeps desktop releases separate from blder/cloud releases.

Commit: `ci(desktop): release workflow`

---

## Task 7: Version bump tooling

**Files:**
- Create: `apps/desktop/scripts/bump-version.mjs`

Script:
- Reads current version from `apps/desktop/package.json`
- Bumps major/minor/patch based on arg
- Creates commit + tag `desktop-v<new>`

Usage: `pnpm --filter @bob/desktop exec node scripts/bump-version.mjs patch`

Commit: `chore(desktop): version bump script`

---

## Task 8: Local signed build verification

**Manual steps (no CI):**

1. Run the full build locally with your local Apple cert:

```bash
export CSC_LINK=<path to local .p12>
export CSC_KEY_PASSWORD=<password>
BOB_BUILD_TARGET=node pnpm --filter @bob/blder build
pnpm --filter @bob/server build
pnpm --filter @bob/desktop build
pnpm --filter @bob/desktop dist
```

2. Verify `apps/desktop/dist-installer/Bob-<version>-universal.dmg` exists

3. Verify signature:
```bash
codesign --verify --deep --strict --verbose=2 "apps/desktop/dist-installer/mac-universal/Bob.app"
spctl --assess --type exec "apps/desktop/dist-installer/mac-universal/Bob.app"
```

Expected: "valid on disk", "accepted".

4. Verify notarization (if local notarytool configured):
```bash
xcrun stapler validate "apps/desktop/dist-installer/mac-universal/Bob.app"
```

Commit: `chore(desktop): local signed build verified` (empty)

---

## Task 9: Clean-Mac smoke test

**Manual steps (separate Mac or clean VM):**

1. Download DMG from a GitHub Releases prerelease (tag `desktop-v0.0.1-rc1`)
2. Open DMG → drag to Applications
3. First launch: macOS allows it without warnings (because it's signed + notarized)
4. App opens, lands on local blder UI
5. Create a workspace → runs `bob init` via bundled daemon → workspace appears
6. Run a trivial agent (echo-test or similar) → artifacts appear in `~/.bob/userdata/`
7. Add a Remote Node server connection → switch → works
8. Add cloud.bob.io connection (if backend OAuth endpoints exist) → switch → works
9. Quit, reopen — state preserved

Commit: `feat(desktop): Phase 4 clean-Mac smoke passes` (empty)

---

## Task 10: Update-path smoke test

**Manual steps:**

1. With DMG v0.0.1 installed (from Task 9), tag + publish a v0.0.2 release
2. In running Bob app, wait up to 4 hours or trigger manual check via menu item
3. Update toast appears
4. Download → Install → app relaunches
5. Verify running v0.0.2 (e.g., check "About" menu)

Commit: `feat(desktop): Phase 4 update-path smoke passes` (empty)

---

## Done criteria

- [ ] Signed universal DMG builds locally and via CI
- [ ] Notarization passes (`stapler validate` OK)
- [ ] Gatekeeper accepts install on clean Mac (no "cannot be opened" dialog)
- [ ] End-to-end flow on clean Mac: install → workspace → agent run → artifacts
- [ ] All three connection kinds work in packaged build
- [ ] electron-updater successfully upgrades v0.0.1 → v0.0.2
- [ ] Release workflow on `desktop-v*` tag produces DMG + publishes to GitHub Releases

When all boxes checked, Bob 0.1 desktop is shipped.

---

## Risks

1. **Universal build size** — arm64 + x64 in one DMG doubles the Electron + PGlite + blder payload. Expect 200–300MB DMG. If unacceptable, split into separate arm64 / x64 DMGs post-launch.
2. **Notarization flakiness** — Apple's notarization service has occasional multi-hour backlogs. Build release notes + comms flow account for this (no "DMG ready in 15 minutes" promises).
3. **Hardened runtime + PGlite WASM** — if `allow-jit` is not enough, PGlite may crash at runtime. Fallback: disable hardened runtime (notarization still passes but security posture is weaker) or explore PGlite's non-JIT build if available.
4. **electron-updater + squirrel.mac quirks** — some updates fail silently on older macOS. Instrument the update machine with user-visible errors (already in the design via `bob:update-state`).
5. **GitHub Releases rate limits** — for frequent releases during early iteration, stay under 5000 API calls/hour. Not a concern at launch volume.
6. **App Sandbox not enabled** — this rules out Mac App Store distribution. Document that the DMG is the only macOS distribution channel for v1; MAS requires extensive sandbox work (no subprocess spawn, no arbitrary TCP listen) that isn't compatible with bob-server.

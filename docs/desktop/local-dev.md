# Running Bob locally on Node + PGlite

This is **Phase 1** of the Electron desktop effort — no Electron shell yet, just the Node-hosted backend using PGlite as the local database. Prove-out for the full-stack running without Cloudflare Workers and without a remote Postgres.

Status: **ships** as of 2026-04-17. See `docs/plans/2026-04-17-electron-phase-1-node-server-plan.md` for design; Phase 2 adds the Electron shell on top.

## One-time setup

- Node ≥ 22
- pnpm 10.19.0
- `pnpm install` at repo root

## Running

```bash
export BOB_BUILD_TARGET=node
export BOB_DB_DRIVER=pglite
export BOB_DB_PGLITE_DIR="$HOME/.bob/userdata/db"
export PORT=3100

# Workaround for vinext: wrangler.jsonc at apps/blder/ triggers Cloudflare
# plugin checks that fail on Node builds. Temporarily hide it during build.
mv apps/blder/wrangler.jsonc apps/blder/wrangler.jsonc.bak
trap 'mv apps/blder/wrangler.jsonc.bak apps/blder/wrangler.jsonc 2>/dev/null' EXIT

pnpm --filter @bob/blder build
pnpm --filter @bob/blder start
```

Open `http://localhost:3100`. Expect 302 → `/runs` → 307 → `/login` → 200 with the full blder UI.

## What happens on first boot

1. PGlite WASM initializes at `$BOB_DB_PGLITE_DIR` (or `~/.bob/userdata/db/` by default).
2. `makePgliteDbSync` calls `bootstrapSchema(client)`:
   - Uses drizzle-kit's programmatic API (`generateDrizzleJson` + `generateMigration`) to diff an empty snapshot against `packages/db/src/schema.ts` with `casing: "snake_case"`.
   - Runs the resulting ~230 DDL statements inside a single transaction.
   - Records every file under `packages/db/drizzle/` in `bob_migrations` with its sha256 hash so subsequent `applyMigrations` calls are a no-op on a freshly bootstrapped DB.
   - Inserts a `__pglite_bootstrap__` sentinel row so future inits skip bootstrap.
3. Server listens on `$PORT`, ready.

Re-runs with the same `$BOB_DB_PGLITE_DIR` hit the sentinel and skip bootstrap.

## Reset local data

```bash
rm -rf "$BOB_DB_PGLITE_DIR"
```

Bootstrap re-runs on next start.

## Switching back to remote Postgres

Unset `BOB_DB_DRIVER` (or set to `pg`) and set `DATABASE_URL`:

```bash
unset BOB_DB_DRIVER
export DATABASE_URL="postgresql://…"
pnpm --filter @bob/blder start
```

## Troubleshooting

**"Missing @cloudflare/vite-plugin" on build** — you didn't hide `apps/blder/wrangler.jsonc`. vinext auto-loads the Cloudflare plugin when it detects wrangler config. See workaround above.

**"Cannot read properties of null (reading 'useState')" on SSR** — React is duplicated. Verify you have exactly one `node_modules/react` at the repo root: `find . -name react -type d -path "*/node_modules/*" -not -path "*/.turbo/*"`. If there are multiple, a dep somewhere is pinning a different version; check `pnpm.overrides` in the root `package.json`.

**PGlite bootstrap fails with ENOENT** — the code bundled under `dist/server/assets/` can't resolve `import.meta.url` back to the source drizzle dir. Set `BOB_DB_MIGRATIONS_DIR` explicitly to point at the real `packages/db/drizzle/` path, or accept the graceful-skip warning (the from-scratch DDL has already been applied, only the pre-marking step needs the dir).

**Schema errors on first query** — the `gateOnReady` proxy should suspend queries until bootstrap completes. If you see "relation does not exist" on a fresh DB, either bootstrap failed earlier (check stderr for `[@bob/db] PGlite bootstrap failed`) or the proxy didn't gate the call path you hit.

## Known limitations (resolved in Phase 2)

- **No Electron shell.** `vinext start` is a raw HTTP server — you're opening the blder UI in your browser, not in a native window.
- **No Go `bob` daemon auto-spawn.** Agent runs need the daemon running separately.
- **Subset of routers.** blder's server still mounts `edgeRouter` (not the full `appRouter`), so git / capture / system / full-settings procedures 404 in this Phase-1 setup. Phase 2's `apps/bob-server` mounts the full router and makes these work locally.
- **Auth flow is web-flow only.** No Electron-native OAuth yet; Phase 3 covers that.

## Next

Phase 2 plan: `docs/plans/2026-04-17-electron-phase-2-shell-plan.md`

# Gmacko

Shared monorepo for Bob and OODA frontends. Will become the gmacko fork of t3code.

## Architecture

- `packages/contracts` — Effect/Schema types, RPC group, tagged errors
- `packages/ui` — Themeable shared UI components (@gmacko/ui)
- `packages/models` — Core domain types (threads, messages, branches)
- `packages/db` — Drizzle ORM schema, dual-driver: PGlite (WASM, default) or PostgreSQL
- `packages/agent` — Claude API streaming dispatch (Effect-wrapped)
- `packages/wiki` — Wiki article writer + cross-linker (Effect-wrapped)
- `apps/server` — Effect HTTP server with RPC handler (port 3001)
- `apps/web` — Next.js 16 web app
- `apps/mobile` — Expo 55 mobile app
- `tooling/typescript` — Shared TypeScript config
- `tooling/tailwind` — Shared Tailwind theme with OODA + Bob presets

## Stack

- **Backend:** Effect 4.0.0-beta.43, Effect-RPC, Drizzle ORM, PGlite (WASM) / PostgreSQL
- **Frontend:** React 19, React Query, Next.js 16 (web), Expo 55 (mobile)
- **Styling:** Tailwind CSS 4, NativeWind 5 (mobile), CVA
- **AI:** Anthropic Claude API via @anthropic-ai/sdk

## Themes

Set `data-theme` attribute: `"ooda"` (dark + gold) or `"bob"` (purple/indigo).

## Development

```
cd apps/server && pnpm dev           # Start Effect server (port 3001, PGlite auto-creates DB at ~/.gmacko/data)
cd apps/web && pnpm dev              # Start web app (port 3000)
cd apps/mobile && pnpm dev           # Start Expo dev server
cd apps/desktop && pnpm dev          # Start Electron desktop app
pnpm test                            # Run all tests
```

### Database drivers

- **Default (PGlite):** No setup needed — WASM Postgres runs in-process, data at `~/.gmacko/data`
- **PostgreSQL:** Set `GMACKO_DB_DRIVER=postgres` and `DATABASE_URL=postgres://...`

## Key Patterns

- RPC contracts defined with Effect/Schema + Rpc.make()
- Services use Effect ServiceMap.Service + Layer pattern
- Web/mobile clients use typed fetch + React Query (no Effect runtime in browser)
- All UI components use CSS custom properties for theming

# Gmacko

Shared monorepo for Bob and OODA frontends. Will become the gmacko fork of t3code.

## Architecture

- `packages/contracts` — Effect/Schema types, RPC group, tagged errors
- `packages/ui` — Themeable shared UI components (@gmacko/ui)
- `packages/models` — Core domain types (threads, messages, branches)
- `packages/db` — Drizzle ORM schema (PostgreSQL)
- `packages/agent` — Claude API streaming dispatch (Effect-wrapped)
- `packages/wiki` — Wiki article writer + cross-linker (Effect-wrapped)
- `apps/server` — Effect HTTP server with RPC handler (port 3001)
- `apps/web` — Next.js 16 web app
- `apps/mobile` — Expo 55 mobile app
- `tooling/typescript` — Shared TypeScript config
- `tooling/tailwind` — Shared Tailwind theme with OODA + Bob presets

## Stack

- **Backend:** Effect 4.0.0-beta.43, Effect-RPC, Drizzle ORM, PostgreSQL
- **Frontend:** React 19, React Query, Next.js 16 (web), Expo 55 (mobile)
- **Styling:** Tailwind CSS 4, NativeWind 5 (mobile), CVA
- **AI:** Anthropic Claude API via @anthropic-ai/sdk

## Themes

Set `data-theme` attribute: `"ooda"` (dark + gold) or `"bob"` (purple/indigo).

## Development

```
docker compose up -d postgres        # Start database
cd packages/db && pnpm db:push       # Push schema
cd apps/server && pnpm dev           # Start Effect server (port 3001)
cd apps/web && pnpm dev              # Start web app (port 3000)
cd apps/mobile && pnpm dev           # Start Expo dev server
pnpm test                            # Run all tests
```

## Key Patterns

- RPC contracts defined with Effect/Schema + Rpc.make()
- Services use Effect ServiceMap.Service + Layer pattern
- Web/mobile clients use typed fetch + React Query (no Effect runtime in browser)
- All UI components use CSS custom properties for theming

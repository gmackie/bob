# Bob production deployment

**Launch target: Cloudflare Workers** at `https://bob.blder.bot`.

Bob's production web + API runs as a Vinext app on Cloudflare Workers, not on a
Node/VPS host. The `apps/bob-server` package is a **desktop/local wrapper only**
(PGlite-backed, auth-gated reverse proxy for Electron packaging). Do not use the
legacy VPS/nginx/systemd paths for production.

## Architecture

| Layer | Target | Notes |
|-------|--------|-------|
| Web + API | CF Worker `blder-bot` @ `bob.blder.bot` | `apps/bob/wrangler.jsonc` |
| Database | Hetzner Postgres via Hyperdrive | `hetzner-master`, binding in wrangler |
| Realtime | `bob-ws-gateway` @ `ws.blder.bot` | systemd on `hetzner-master` |
| Agent runner | `ooda-runner` / execution daemon | `hetzner-bob` / `labnuc` |
| Auth hub | CF Worker @ `blder.bot` | `apps/blder` (shared `.blder.bot` cookies) |

## Deploy web (production)

From a Tailscale-connected host (for schema migrations) or CI (code-only):

```bash
# 1. Apply pending DB migrations (skipped in CI — run manually when schema changes)
cd apps/bob && pnpm predeploy
# or: DATABASE_URL=$(forge db url --app bob) pnpm -F @bob/db migrate

# 2. Ship the worker
cd apps/bob && pnpm exec vinext deploy
```

CI (`.forgejo/workflows/ci.yml`) runs step 2 automatically on `master` after
tests pass. The `predeploy` hook is skipped in CI because it needs Tailscale to
reach production Postgres.

Required repo secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.

## Configuration

Canonical worker config: `apps/bob/wrangler.jsonc`

- Route: `bob.blder.bot` (custom domain)
- `FRONTEND_URL`: `https://bob.blder.bot`
- `GATEWAY_URL` / `GATEWAY_PUBLIC_URL`: `https://ws.blder.bot`
- Hyperdrive binding → Hetzner Postgres

Do not add a second `wrangler.jsonc` under `apps/bob/src/` — vinext reads the
app-root file only.

## What is NOT production

- `deploy/setup-vps.sh`, `deploy/nginx-bob.conf`, `deploy/bob-nextjs-hosted.service`
  — removed. These described an abandoned Node/VPS path (`claude.gmac.io`,
  Next.js hosted mode) that conflicts with the CF Workers launch target.
- `apps/bob-server` — local desktop shell only (`BOB_BUILD_TARGET=node`, PGlite).
- `apps/bob` with `BOB_BUILD_TARGET=node` — build-time target for bob-server, not prod.

## Supporting services

Deploy separately (not via wrangler):

- WS gateway: `apps/bob-ws-gateway/deploy.sh` → `hetzner-master`
- Execution daemon: `apps/bob-execution/deploy-hetzner-bob.sh` → `hetzner-bob`
- OODA runner: `apps/ooda-runner/deploy-labnuc.sh` → `labnuc`

See `.forgegraph.yaml` for ForgeGraph stage topology and operator notes.

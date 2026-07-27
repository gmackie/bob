# Re: OODA dispatch auth for LevelForge studio → it's live

**Status: shipped and verified live on `https://ooda.blder.bot` (2026-07-23).**

Short version: your existing Bob device-flow API key now authenticates against
OODA's tRPC API directly. **You don't need to enable the better-auth `apiKey()`
plugin** — Bob's programmatic keys don't live in that plugin's store, so wiring
it in wouldn't have found your key. We validated your key type against the real
`api_keys` table instead. Nothing on your side needs to change auth-wise beyond
sending the header.

## How to call it

Send your Bob `bob_…` key (the one your studio backend already has from the
device flow) on any OODA tRPC request, as **either** header form:

```
x-api-key: bob_xxxxxxxxxxxxxxxx
```
or
```
Authorization: Bearer bob_xxxxxxxxxxxxxxxx
```

Both are accepted on `authedProcedure`. Endpoint base:

```
https://ooda.blder.bot/api/trpc/<procedure>
```

### Verified example

An unknown/garbage key is cleanly rejected with **401** (not a 500), and a real
`bob_` key passes auth and reaches the procedure. E.g. dispatching against
`threads.create` with a valid key returns a normal input-validation/`200`
response — i.e. it's past auth, running as the key's owner:

```bash
curl -sS -X POST "https://ooda.blder.bot/api/trpc/threads.create" \
  -H "content-type: application/json" \
  -H "x-api-key: bob_YOURKEY" \
  --data '{"json":{"title":"...", "slug":"..."}}'
```

## What the key resolves to

- Auth is by **exact `sha256(key)` match** against `api_keys.key_hash`. Revoked
  (`revoked_at`) and expired (`expires_at`) keys are rejected. There is no
  bypass — a missing/malformed/unknown key → 401.
- On success, the request runs as the key's **owning user** (`ctx.userId` =
  `api_keys.user_id`). `permissions` on the key are available for finer gating
  if a given procedure wants them.
- Identity is established by `userId`. (Email is best-effort/empty on this path —
  we deliberately skip the users-table join because the live DB's
  `api_keys.user_id` is a text FK to the better-auth `user` table, which
  type-clashes the newer uuid `users` table. Doesn't affect authorization.)

## One thing to know about the plumbing

OODA's edge (`ooda.blder.bot`) shares **Bob's database** — that's why your
`bob_` key is visible to OODA at all (both read the same `api_keys` table). We
had to restore that shared connection as part of this work (OODA's DB binding
had been pruned at Cloudflare's Hyperdrive account cap); it's back and the OODA
runner is online. No action needed from you — just flagging that OODA dispatch
and Bob share one identity/key space.

## Still on your side: the runner label

Heads-up unrelated to auth: your Unity host's self-hosted runner keeps
re-registering with generic labels (`ubuntu-latest`), which pulls in Bob CI jobs
it can't run and poisons those builds. We've re-scoped it to
`["self-hosted","unity"]` on our end as a stopgap, but the durable fix is to pin
its labels on your side so it only advertises the Unity capability. Once your
studio dispatch flow is live end-to-end (studio → Bob runner → Claude adapter →
MCP → Unity), that runner should only ever claim Unity work.

## TL;DR for your integration

1. Take the `bob_…` key your studio backend already holds.
2. Send it as `x-api-key` (or `Authorization: Bearer`) to
   `https://ooda.blder.bot/api/trpc/<procedure>`.
3. You're authenticated as that key's user. Dispatch away.

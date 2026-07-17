# Hetzner Bob Runtime Verify

Last verified: 2026-07-13

This runbook captures the current shared-backend Bob layout on `hetzner-bob`
and the minimum checks needed to confirm that Bob still works locally and on
the host.

## Host topology

- Public web/API: `https://bob.blder.bot` (Cloudflare Worker)
- Public gateway: `https://ws.blder.bot`
- Execution daemon: `bob-execution.service`
- Execution daemon artifact: `/opt/bob/execution-daemon/dist/daemon/index.js`
- Bob app service: `bob-gmacko.service`
- Bob app URL: `http://127.0.0.1:3200`
- Bob runtime mirror sidecar: `bob-runtime-mirror.service`
- Bob runtime mirror URL: `http://127.0.0.1:3301/api/v1/t3code/runtime-events`
- T3 service: `t3code-bob.service`
- T3 URL: `http://127.0.0.1:3773`
- Bob host checkout: `/opt/bob-gmacko`
- T3 home: `/home/bob/.t3-bob`

## Important current facts

- The production mobile/web execution path is:

  ```text
  bob.blder.bot -> ws.blder.bot -> bob-execution.service -> provider CLI
                 -> session events -> hetzner-master Postgres
  ```

- `bob-execution.service` is the production launcher for Claude, Codex, Grok,
  and Cursor. The canonical provider runtime is under
  `apps/bob-execution/src/providers/`.
- `bob-gmacko.service`, `t3code-bob.service`, and
  `bob-runtime-mirror.service` form a separate T3 bridge candidate. A healthy
  T3 bridge does not prove the mobile/web execution path, and zero
  `t3_runtime_event` rows does not mean production execution is broken.
- `bob-gmacko.service` is healthy when `curl http://127.0.0.1:3200/api/health`
  returns `200`.
- `t3code-bob.service` mirrors runtime events to the sidecar, not directly to
  the Bob app route.
- `BOB_API_BASE_URL` in `/etc/t3code-bob/env` points to `http://127.0.0.1:3301`.
- The standalone sidecar currently expects its dedicated localhost-only
  `bob-auth-bypass:<token>` bearer format and restricts writes to
  `BOB_AUTH_BYPASS_USER_ID`. Do not expose port `3301` publicly or reuse this
  credential for the public gateway/API.
- Bob no longer uses local Postgres on `127.0.0.1:5432`.
  `DATABASE_URL` in `/opt/bob-gmacko/.env` points to `hetzner-master:5432`.
- The runtime mirror sidecar only accepts events for sessions owned by the
  API key's user. A `403 Forbidden` from the sidecar means the task exists
  but belongs to another Bob user. A `404 Session not found` means the
  task/session IDs are stale or absent in the current database.

## Host verification

Run these from the local repo root:

```bash
ssh root@hetzner-bob \
  'systemctl status bob-execution.service bob-gmacko.service bob-runtime-mirror.service t3code-bob.service --no-pager -n 30'

ssh root@hetzner-bob 'curl -sS http://127.0.0.1:3200/api/health'
```

Expected:

- all four services show `active (running)`
- Bob health returns `{"status":"healthy",...}`

Confirm the public Worker and login surface:

```bash
curl -sS https://bob.blder.bot/api/health
curl -sS -I https://bob.blder.bot/runs
```

Expected: health returns `200`; an unauthenticated `/runs` request redirects
to `/login`.

Confirm the provider CLIs available to the daemon user:

```bash
ssh root@hetzner-bob \
  'sudo -u bob env HOME=/home/bob PATH=/home/bob/.local/bin:/home/bob/.npm-global/bin:/usr/local/bin:/usr/bin:/bin bash -lc \
  "codex --version; cursor-agent --version; grok --version; claude --version"'
```

Do not infer provider success from `chat_conversations.agent_type` alone.
Correlate a completed conversation and task run, then inspect the first output
event for the provider-native stream format.

```sql
select cc.agent_type, cc.id, tr.id as task_run_id,
       cc.status, tr.status, tr.completed_at
from chat_conversations cc
join task_runs tr on tr.session_id = cc.id
where cc.agent_type in ('codex', 'cursor', 'grok')
order by cc.created_at desc;
```

Check the live Bob database target:

```bash
ssh root@hetzner-bob \
  'rg -n "^DATABASE_URL=" /opt/bob-gmacko/.env && cat /etc/t3code-bob/env | rg "BOB_API_BASE_URL|BOB_API_KEY"'
```

## Local verification

The multi-provider source currently used by the deployed daemon is maintained
on `feat/multi-provider-mission-control`. Verify that worktree before deploying
provider changes.

```bash
pnpm -F @bob/execution test
pnpm -F @bob/execution typecheck
pnpm -F @bob/execution build:daemon
pnpm -F @bob/mobile test
```

Compare the locally built daemon to the deployed artifact:

```bash
sha256sum apps/bob-execution/dist/daemon/index.js
ssh root@hetzner-bob \
  'sha256sum /opt/bob/execution-daemon/dist/daemon/index.js'
```

The hashes must match when verifying exact source/deployment parity.

Start Bob locally from the repo:

```bash
set -a
source apps/bob/.env.local
set +a
cd apps/bob
pnpm start -- --host 127.0.0.1 --port 3210
```

In another shell:

```bash
curl -sS http://127.0.0.1:3210/api/health
curl -I http://127.0.0.1:3210/
curl -I http://127.0.0.1:3210/runs
```

Expected:

- `/api/health` returns `200`
- `/` redirects to `/runs`
- `/runs` redirects into auth when unauthenticated

## Optional T3 runtime mirror checks

These checks validate only the T3 candidate path, not the production
mobile/web provider path. The sidecar accepts only its dedicated bearer token:

```bash
curl -sS -X POST http://127.0.0.1:3301/api/v1/t3code/runtime-events \
  -H "Authorization: Bearer bob-auth-bypass:$BOB_AUTH_BYPASS_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{"taskRunId":"<live-task-run-id>","threadId":"probe","status":"working","message":"probe"}'
```

Interpretation:

- `200 {"ok":true}`: sidecar accepted and wrote the mirror event
- `403 {"error":"Forbidden"}`: live task belongs to a different Bob user
- `404 {"error":"Session not found"}`: task/session ID is stale

Do not reuse the old June 22 probe IDs blindly. Re-query the live database
first.

## Disk pressure

The main recurring host risk is stale T3 worktree artifacts under:

```text
/home/bob/.t3-bob/worktrees/bob-nextjs/
```

On 2026-06-29 there were only two worktrees, but one old June 22 proof
worktree had grown to `1.7G` entirely because of its `node_modules`.

Safe reclaim:

```bash
ssh root@hetzner-bob \
  'rm -rf /home/bob/.t3-bob/worktrees/bob-nextjs/<stale-worktree>/node_modules'
```

This preserves the git worktree contents while reclaiming rebuildable
dependencies.

Useful inspection commands:

```bash
ssh root@hetzner-bob 'df -h / /home /opt'
ssh root@hetzner-bob 'du -sh /home/bob/.t3-bob/* 2>/dev/null | sort -h'
ssh root@hetzner-bob 'find /home/bob/.t3-bob/worktrees/bob-nextjs -mindepth 1 -maxdepth 1 -type d -printf "%TY-%Tm-%Td %TH:%TM %f\n" | sort'
```

## Known pitfalls

- A completed `agent_type='cursor'` or `agent_type='grok'` row is not enough to
  prove the native provider ran. Verify the provider-native event payload or
  the daemon spawn log.
- Do not rebuild `/opt/bob/execution-daemon` from a branch that lacks
  `apps/bob-execution/src/providers/runtime.ts`; older daemon source falls back
  to Claude for unrecognized provider labels.
- Do not use T3 sidecar event counts as the health signal for the public
  mobile/web execution path. They are separate paths.
- A momentary `systemctl status` view showing `activating (auto-restart)` is
  not enough to call Bob broken. Re-check the unit and the health endpoint.
- `vinext: not found` in the journal means the host dependency install is
  broken, not that T3 is broken.
- `SENTRY_DSN` / `FG_APP` errors are Bob app runtime errors inside the Vinext
  server and need to be treated separately from service boot.
- `ENOSPC` in `t3code-bob.service` points to host disk pressure, usually stale
  worktree artifacts under `/home/bob/.t3-bob`.

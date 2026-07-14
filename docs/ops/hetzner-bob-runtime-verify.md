# Hetzner Bob Runtime Verify

Last verified: 2026-06-29

This runbook captures the current shared-backend Bob layout on `hetzner-bob`
and the minimum checks needed to confirm that Bob still works locally and on
the host.

## Host topology

- Bob app service: `bob-gmacko.service`
- Bob app URL: `http://127.0.0.1:3200`
- Bob runtime mirror sidecar: `bob-runtime-mirror.service`
- Bob runtime mirror URL: `http://127.0.0.1:3301/api/v1/t3code/runtime-events`
- T3 service: `t3code-bob.service`
- T3 URL: `http://127.0.0.1:3773`
- Bob host checkout: `/opt/bob-gmacko`
- T3 home: `/home/bob/.t3-bob`

## Important current facts

- `bob-gmacko.service` is healthy when `curl http://127.0.0.1:3200/api/health`
  returns `200`.
- `t3code-bob.service` mirrors runtime events to the sidecar, not directly to
  the Bob app route.
- `BOB_API_BASE_URL` in `/etc/t3code-bob/env` points to `http://127.0.0.1:3301`.
- `BOB_API_KEY` in `/etc/t3code-bob/env` must be a REAL API key provisioned
  via Bob's settings router (hashed + revocable in the `api_keys` table).
  The legacy bypass form `bob-auth-bypass:<token>` is dead: the gateway
  refuses to boot with `BOB_AUTH_BYPASS` set in production
  (`assertNoAuthBypassInProduction`), and no production caller may depend on
  it. To migrate: create an API key for the bob user, replace the value in
  `/etc/t3code-bob/env`, restart `t3code-bob.service`, verify events flow.
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
  'systemctl status bob-gmacko.service bob-runtime-mirror.service t3code-bob.service --no-pager -n 30'

ssh root@hetzner-bob 'curl -sS http://127.0.0.1:3200/api/health'
```

Expected:

- all three services show `active (running)`
- Bob health returns `{"status":"healthy",...}`

Check the live Bob database target:

```bash
ssh root@hetzner-bob \
  'rg -n "^DATABASE_URL=" /opt/bob-gmacko/.env && cat /etc/t3code-bob/env | rg "BOB_API_BASE_URL|BOB_API_KEY"'
```

## Local verification

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

## Runtime mirror checks

The sidecar accepts only authenticated POSTs:

```bash
curl -sS -X POST http://127.0.0.1:3301/api/v1/t3code/runtime-events \
  -H "Authorization: Bearer $BOB_API_KEY" \
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

- A momentary `systemctl status` view showing `activating (auto-restart)` is
  not enough to call Bob broken. Re-check the unit and the health endpoint.
- `vinext: not found` in the journal means the host dependency install is
  broken, not that T3 is broken.
- `SENTRY_DSN` / `FG_APP` errors are Bob app runtime errors inside the Vinext
  server and need to be treated separately from service boot.
- `ENOSPC` in `t3code-bob.service` points to host disk pressure, usually stale
  worktree artifacts under `/home/bob/.t3-bob`.

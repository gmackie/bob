# Hetzner Bob Runtime Verify

Last verification: 2026-09-06 (read-only service inspection and isolated acceptance fixtures; no deployment).

This runbook captures the current shared-backend Bob layout on `hetzner-bob`
and the minimum checks needed to confirm that Bob still works locally and on
the host.

## Host topology

- Active gateway daemon owner: `ooda-runner.service`
- Standalone execution daemon: `bob-execution.service` (inactive; do not start while OODA owns the workspace slot)
- Bob app service: `bob-gmacko.service`
- Bob app URL: `http://127.0.0.1:3200`
- Bob runtime mirror sidecar: `bob-runtime-mirror.service`
- Bob runtime mirror URL: `http://127.0.0.1:3301/api/v1/t3code/runtime-events`
- T3 service: `t3code-bob.service`
- T3 URL: `http://127.0.0.1:3773`
- Bob host checkout: `/opt/bob-gmacko`
- T3 home: `/home/bob/.t3-bob`

## Verified state and acceptance limits

On September 6, `ooda-runner`, `bob-gmacko`, `bob-runtime-mirror` and
`t3code-bob` were active; `bob-execution` was inactive. OODA owns the gateway
daemon slot. Starting a second daemon for the same workspace can evict that
owner. The deployment script retains its ownership check before starting Bob.

The host's `/usr/bin/node` is 20.19.6. The provisioned Bob executable at
`/home/bob/.local/bin/node` resolves to Node 24.16.0 and supports `node:sqlite`.
The revised **checked-in** `bob-execution.service` selects that executable;
the revised deployment preflight checks it as user `bob` before building or
mutating remote files. These source changes have not been deployed. Do not
infer the installed unit's contents from the repository file.

A fresh standalone bundle passed its isolated transient-systemd lifecycle
fixture in 17.45 seconds. A real Grok fixture completed. Codex was blocked by
provider quota and Claude by authentication. Cursor also returned an external
usage-limit error; its supported CLI flags were accepted and the daemon
reported the provider failure correctly. These observations do not establish provider-wide readiness,
production deployment parity or signed release acceptance.

The endpoint paths above are retained operational references. Recheck their
health independently of unit state. Earlier observations recorded T3 sending
events to the mirror sidecar and Bob using the remote database rather than
localhost Postgres. The presence-only probe below does not revalidate that
database routing.

The sidecar's dedicated localhost bearer credential must remain scoped to its
configured owner. Do not expose port 3301 publicly or reuse this credential
for the public gateway/API.

## Host verification

Run these from the local repo root. Print status fields and HTTP status codes,
not unit environment values, process command lines or response payloads:

```bash
ssh root@hetzner-bob \
  'systemctl show ooda-runner.service bob-execution.service bob-gmacko.service bob-runtime-mirror.service t3code-bob.service --property=Id,ActiveState,SubState,MainPID'

ssh root@hetzner-bob \
  'curl --silent --show-error --output /dev/null --write-out "%{http_code}\n" http://127.0.0.1:3200/api/health'
```

Expected owner state is OODA active and Bob execution inactive; the app,
mirror and T3 services should be active. Bob health should return HTTP 200.
An inactive Bob execution service is intentional in this topology.

Check configured secret presence without printing any values or sourcing
remote configuration as shell code:

```bash
ssh root@hetzner-bob python3 - <<'PY_CHECK'
from pathlib import Path

checks = {
    "/opt/bob-gmacko/.env": ("DATABASE_URL",),
    "/etc/t3code-bob/env": ("BOB_API_BASE_URL", "BOB_API_KEY"),
}
for filename, names in checks.items():
    path = Path(filename)
    if not path.is_file():
        print(f"{filename}: missing file")
        continue
    configured = {}
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:]
        key, separator, value = line.partition("=")
        if separator and key.strip() in names:
            configured[key.strip()] = bool(value.strip().strip("\"'"))
    for name in names:
        print(f"{filename}: {name}={'present' if configured.get(name) else 'missing or empty'}")
PY_CHECK
```

Presence is not proof of a valid credential or the database destination. Do
not use `cat`, `rg`, `systemctl show -p Environment` or shell tracing to expose
secret-bearing configuration in verification logs.

Verify the same service-user Node runtime without restarting any service:

```bash
ssh root@hetzner-bob /usr/sbin/runuser -u bob -- /home/bob/.local/bin/node <<'NODE_CHECK'
if (Number(process.versions.node.split(".")[0]) < 24) process.exit(1);
require("node:sqlite");
console.log(JSON.stringify({ node: process.versions.node, uid: process.getuid() }));
NODE_CHECK
```

## Standalone artifact provenance

`apps/bob-execution/daemon-runtime-package-lock.json` is the checked-in,
standalone npm lock for `daemon-runtime-package.json`. The manifest retains
version ranges for maintenance; the lock pins the actual resolved registry
artifacts and their integrity hashes. It is independent of the monorepo's
pnpm lock.

The deployment script copies both files into its isolated stage as
`package.json` and `package-lock.json`, installs with
`npm ci --omit=dev --ignore-scripts` against the official npm registry, and
transfers the lock alongside the
bundle and installed dependencies. A manifest/lock mismatch fails the install.
The runtime preflight still runs before any staging or remote mutation.
CI checks manifest agreement, registry artifact integrity and this ordering.

On September 6 the isolated lock installation and npm production audit
reported zero known vulnerabilities. This is an audit result for that exact
lock at that time, not a permanent assurance. Dependency updates require an
intentional lock refresh and renewed standalone lifecycle acceptance.

For promotion, retain the source revision, tested bundle hashes, lock hash,
Node version, resolved inventory and lifecycle receipt together. Reconstruct
with the checked-in lock using `npm ci`; do not replace it with `npm install`
or resolve dependencies on the production host. The checked-in lock provides
reproducible dependency selection; it does not prove deployed code parity,
artifact signing or successful provider authentication. Promote only the
artifact that received acceptance, and compare its hashes before promotion.

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

Authentication is required for event writes. An unauthenticated request can
check rejection without exposing a credential or changing a task:

```bash
ssh root@hetzner-bob \
  'curl --silent --show-error --output /dev/null --write-out "%{http_code}\n" -X POST http://127.0.0.1:3301/api/v1/t3code/runtime-events -H "Content-Type: application/json" --data "{}"'
```

Expect an authentication rejection (401 or 403), then inspect the handler if
it differs. This does not prove an authenticated write works.

Authenticated acceptance writes a real event and therefore requires a
specifically designated disposable task owned by the configured credential's
user. Supply credentials through the acceptance process's environment or
private credential input, never a literal command-line argument or log. Do
not reuse old probe IDs or write a probe into a production task. Interpret
200 as an accepted event, 403 as an ownership/authentication denial, and 404
as an absent task/session; none alone proves end-to-end UI rendering.

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

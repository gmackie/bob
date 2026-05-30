# @bob/task-runner

Standalone Node script that polls Linear for unstarted issues across the
configured startup projects, picks the highest-priority one, dispatches
`codex exec` to work on it, pushes the branch, and reports the run (status +
output) to Bob's public run API so it's visible in the Bob dashboard.

No build step — it runs as plain Node (`node task-runner.js`).

## Run

```
node task-runner.js [--dry-run] [--startup <slug>] [--once]
```

- `--once` — process a single issue and exit (otherwise loops: work, wait 2m, repeat; 10m when idle).
- `--startup <slug>` — restrict to one startup.
- `--dry-run` — don't run codex or report; just show what would happen.

## Configuration (env)

| Var | Purpose | Default |
|-----|---------|---------|
| `LINEAR_API_KEY` | Linear API key | falls back to `LINEAR_KEY_FILE` |
| `LINEAR_KEY_FILE` | File holding the Linear key | `/home/bob/.linear-key` |
| `LINEAR_TEAM_ID` | Linear team id | the gmackie team |
| `PULSE_API_KEY` | BizPulse key passed to codex | unset (optional) |
| `BOB_API_URL` | Bob base URL for run reporting | unset (reporting off) |
| `BOB_API_KEY` | Bob API key (`bob_live_...`, write perm) | unset |
| `BOB_WORKSPACE_ID` | Bob workspace to record runs under | unset |
| `BOB_RUNNER_STATE_DIR` | State + logs dir | `/home/bob/.bob-runner` |
| `BOB_RUNNER_REPOS` | JSON `{slug: repoDir}` override | built-in map |
| `BOB_RUNNER_PROJECTS` | JSON `{slug: linearProjectId}` override | built-in map |

Secrets are read from the environment only — never commit `PULSE_API_KEY` or
the Linear key.

## Bob run reporting

When `BOB_API_URL` + `BOB_API_KEY` + `BOB_WORKSPACE_ID` are set, each issue:

1. opens a run (`POST /api/v1/runs`, status `running`) **at claim time** so it
   appears in the dashboard immediately;
2. attaches codex stdout/stderr as an inline `log` artifact
   (`POST /api/v1/runs/:id/artifacts`);
3. closes with `completed` (commits pushed) or `failed` (no commits / error).

Reporting is best-effort: a reporting failure only logs a warning and never
interrupts the run.

## Deploy (hetzner-bob)

Runs under systemd as `bob-task-runner.service` from `/opt/bob/task-runner`.

```
# from a checkout on the node:
cp apps/bob-task-runner/task-runner.js /opt/bob/task-runner/task-runner.js
node --check /opt/bob/task-runner/task-runner.js
systemctl restart bob-task-runner
```

Config + secrets live in `/opt/bob/task-runner/.env` (see the reference
`bob-task-runner.service` unit). Reporting uses the Bob API key whose
`permissions` include `write`.

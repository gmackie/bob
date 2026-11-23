# Budget usage collector (BOB-76)

CLIProxyAPI records every request in a usage queue that
`GET /v0/management/usage-queue?count=N` pops destructively. Exactly one
process may drain it. In production that process is the **budget collector
on labnuc**, the host the proxy runs on, so the token ledger no longer depends
on any runner being up.

```
labnuc                                    hetzner-master             hetzner-bob
cli-proxy-api ──usage-queue──▶ bob-budget-collector ──POST /internal/budget-usage──▶ bob-ws-gateway ──▶ Postgres (budget_*)
                                                                          ▲
                                         ooda-runner (BOB_BUDGET_USAGE_SOURCE=remote) ── budget_usage {links} over its socket
```

- **Collector** (`apps/ooda-runner/src/budget/collector.ts`): drains the queue
  every 15 s, attributes each record to Bob or interactive use by the proxy
  API key it was made with, spools the ledger to
  `/var/lib/bob-budget-collector/usage-ledger.json`, and posts running totals
  as host `labnuc`. A post that fails stays queued and goes out on the next
  tick; the last three hours are resent every 10 minutes.
- **Gateway** (`apps/bob-ws-gateway/src/budget-http.ts`): accepts only a Bob
  API key owned by the workspace's owner (the legacy shared secret is
  refused), validates every row, and upserts it with the same code as the
  socket path.
- **Runner**: with `BOB_BUDGET_USAGE_SOURCE=remote` it never touches the
  queue and only ships the run-to-agent-session links that tie usage to work
  items. The per-run runaway cap (`BOB_BUDGET_RUN_WEIGHTED_TOKEN_CAP`) needs
  per-run usage, so it is ignored in this mode.

Meters (5-hour and weekly utilization) are not part of this: the runner still
reads them from the proxy's auth files on every ping, which is not destructive.

## Configuration

`/etc/bob-budget-collector/env` on labnuc, `root:root 0600`:

| Variable | Value |
|---|---|
| `CLIPROXY_BASE_URL` | `http://127.0.0.1:8317` (default) |
| `CLIPROXY_MANAGEMENT_KEY` | the proxy's management key (plaintext; the proxy config stores only its hash) |
| `BOB_BUDGET_BOB_API_KEYS` | comma-separated proxy API keys Bob's runners use; every other key counts as interactive |
| `BOB_GATEWAY_INTERNAL_URL` | `http://100.101.32.120:3003` (hetzner-master over Tailscale) |
| `BOB_BUDGET_COLLECTOR_TOKEN` | a Bob API key (`gmk_…`) owned by the workspace owner, named `budget-collector@labnuc` |
| `BOB_WORKSPACE_ID` | the workspace the budget belongs to |

The unit sets `BOB_BUDGET_HOST_ID=labnuc` and the spool path, runs as a
dynamic user, and can reach nothing on disk except its state directory.

## Deploy

```
apps/ooda-runner/deploy-budget-collector.sh labnuc
```

It bundles the collector with esbuild into one file, installs it under
`/opt/bob-budget-collector/releases/<commit>`, points `current` at it, and
restarts the unit. Roll back by pointing `current` at an earlier release.

## Cutover and checks

1. Deploy the gateway with `/internal/budget-usage`.
2. Start the collector; for a few seconds it and the runner both drain, which
   is safe because each record is popped once and ledger rows are keyed by
   host.
3. Restart the runner with `BOB_BUDGET_USAGE_SOURCE=remote`.

Healthy state:

```sql
select host_id, source, max(hour), sum(requests) from budget_usage_ledger
where hour > now() - interval '2 hours' group by 1, 2;
```

shows `labnuc` rows advancing and no new `hetzner-bob` hours, and
`journalctl -u bob-budget-collector` logs a status line every 10 minutes with
`gapsOver45s` and `sendFailures`. A gap means records may have expired before
they were drained; with the proxy's `redis-usage-queue-retention-seconds: 3600`
the collector can be down for up to an hour without losing any.

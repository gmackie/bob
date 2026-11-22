# hermes-shepherd

Operator files for Hermes on `hetzner-bob` (user `bob`, `HERMES_HOME=/home/bob/.hermes`).

| Path | What it is |
|---|---|
| `hermes-config/` | **Versioned Hermes config** (BOB-108): the default `config.yaml`, the `hermes-console` and `hermes-operator` profile configs, and `job-models.json` (provider/model pins for the daily jobs). Byte-identical to what runs; no secrets. Secrets live only in the untracked `.env` files. |
| `ops/hermes-health-check.py` | Loud failure check run by `hermes-daily-canary.{service,timer}` at 15:30 and 06:30 UTC. Runs after the 07:00 morning briefing and the 22:00 nightly wrap-up (America/Los_Angeles). |
| `ops/install-hermes-config.sh` | Delivers `hermes-config/` and the health check. `--check` is a read-only drift report. |
| `ops/install-hermes-operator.sh` | Delivers the hermes-operator plugin and its cron reconciler. |
| `plugins/hermes-operator/` | The Bob operator plugin. |

## Changing the Hermes config (e.g. a model is retired)

1. Edit `hermes-config/config.yaml` (plus the two profile configs) and, when the
   default model changes, `hermes-config/job-models.json`. The contract test
   requires the job pins to follow `model.default`/`model.provider`.
2. `node --test apps/hermes-shepherd/test/ops-contract.test.mjs` and
   `python3 -m unittest discover -s apps/hermes-shepherd/test`. CI runs both.
3. Merge the PR, then deliver from the merge commit (below).

Never hand-edit `/home/bob/.hermes/config.yaml` without bringing the change back
here. The next delivery would revert it, and `install-hermes-config.sh --check`
reports it as drift.

## Delivery to hetzner-bob

This is a `deliveryMode: manual` systemd target. Ship from an immutable export of
the merge commit, never from a dirty checkout:

```bash
SHA=<merge sha>
REL=/opt/bob/releases/hermes-config-${SHA:0:12}
sudo install -d "$REL"
sudo -u bob git -C /home/bob/dev/gmacko-bob fetch origin master   # fetch only; leaves the runner checkout untouched
sudo -u bob git -C /home/bob/dev/gmacko-bob archive "$SHA" apps/hermes-shepherd | sudo tar -x -C "$REL"
sudo "$REL/apps/hermes-shepherd/ops/install-hermes-config.sh" --check   # what would change
sudo "$REL/apps/hermes-shepherd/ops/install-hermes-config.sh"           # install, then re-checks
```

The installer replaces a config only when it differs. It backs up the live file
to `<file>.bak-<UTC stamp>` first, and only then restarts `hermes-gateway.service`.
It never touches other bob services. It exits non-zero unless the final
`--check` reports `hermes config: in sync`.

### ForgeGraph target: `hermes-systemd` (BOB-110)

Hermes is a production target of the ForgeGraph app `bob`, registered on the
server (not in `.forgegraph.yaml`) with `forge target add`, like
`runner-systemd`, `coordinator-systemd` and `gateway-systemd`. Inspect it with
`forge --json target list --stage production`:

| Field | Value | Why |
|---|---|---|
| id | `49bbe1be-0f06-492f-ab52-61d6bc800336` | `targetId` in the receipt |
| platform / node | `forgegraph-node` / `hetzner-bob` | |
| `deliveryMode` | `manual` | delivery is the installer above, not `forge deploy` |
| `watchPaths` | `apps/hermes-shepherd/` | only PRs that touch this directory owe Hermes a receipt |
| `serviceName` | `hermes-daily-canary.service` | each run of the Hermes health check is a fresh systemd invocation; its InvocationID identifies the delivery |
| `healthUrl` | `http://127.0.0.1:9119/api/status` | Hermes dashboard status (`gateway_running`), loopback only on hetzner-bob |
| `evidenceSuite` | `production:hetzner-bob:hermes` | |
| `completionGroup` | `hermes` | Hermes is rolled out alone |

Before this target existed, a merged Hermes PR owed only the website Worker
(`production-cf`), so the Worker deploy closed Hermes issues before Hermes was
verified (BOB-108). Now a PR touching `apps/hermes-shepherd/` stays open in
Kanbanger until a `hermes-systemd` receipt arrives. A PR that doesn't touch it
reports `not_required` for this target. Check what a merged PR owes, without
queueing anything:

```bash
forge --json receipts backfill --app bob --dry-run                       # every uncredited merged PR
forge --json receipts backfill --app bob --dry-run \
  --changeset <changeset-id> --expected-head <head-sha>                  # one PR
```

To change the target, use `forge target update`. To recreate it:

```bash
forge target add hermes-systemd --app bob --stage production --platform forgegraph-node \
  --node 49db79fe-2dc1-4be4-97d7-05ffd56df7d0 \
  --config '{"deliveryMode":"manual","completionGroup":"hermes","serviceName":"hermes-daily-canary.service","healthUrl":"http://127.0.0.1:9119/api/status","evidenceSuite":"production:hetzner-bob:hermes","watchPaths":["apps/hermes-shepherd/"]}'
```

### Recording a Hermes delivery

Do this after the installer above has run for the merge commit. Every step is
read-only on the node; nothing here restarts Hermes.

1. **Wait for a Hermes check run after the install.** The receipt names one
   `hermes-daily-canary.service` invocation that started after the install
   finished. Use the next timer run (06:30 or 15:30 UTC). Don't start the unit
   by hand: if Hermes is unhealthy, that run sends a real Telegram alert. The
   run must have succeeded:

   ```bash
   forge node exec --node hetzner-bob 'systemctl show hermes-daily-canary.service \
     -p InvocationID -p Result -p ExecMainStatus -p ExecMainStartTimestamp -p ExecMainExitTimestamp'
   forge node exec --node hetzner-bob 'journalctl _SYSTEMD_INVOCATION_ID=<InvocationID> --no-pager -o cat'
   ```

   Pass: `Result=success`, `ExecMainStatus=0`, `ExecMainStartTimestamp` after
   the install, and a `hermes-health-check: ok: jobs healthy and Daily/<date>.md present`
   line. A failed run has already alerted. Fix Hermes, deliver again, and wait
   for the next run.

2. **Check the rest of Hermes and record the artifact:**

   ```bash
   forge node exec --node hetzner-bob "sudo $REL/apps/hermes-shepherd/ops/install-hermes-config.sh --check"  # hermes config: in sync
   forge node exec --node hetzner-bob 'systemctl is-active hermes-gateway.service; curl -s http://127.0.0.1:9119/api/status'  # active; "gateway_running":true
   forge node exec --node hetzner-bob "sudo -u bob git -C /home/bob/dev/gmacko-bob archive --format=tar $SHA apps/hermes-shepherd | sha256sum"
   ```

   The artifact is that sha256, the reproducible `git archive` of
   `apps/hermes-shepherd` at the merge commit.

3. **Persist the acceptance** against the merged PR's changeset. The external
   run ID must be `hetzner-bob-systemd-<InvocationID>`:

   ```bash
   forge evidence push --changeset <merged-changeset-id> --suite production:hetzner-bob:hermes \
     --external-run-id hetzner-bob-systemd-<InvocationID> --source gitea_ci \
     --passed 4 --failed 0 --skipped 0 --total 4 --json   # canary ok, config in sync, gateway active, dashboard status
   ```

4. **File the receipt** (workspace owner/admin) with `forge integration kanbanger receipt --file receipt.json`:

   ```json
   {
     "kind": "manual_deploy",
     "changesetId": "<merged-changeset-id>",
     "expectedHeadSha": "<reviewed PR head sha>",
     "evidenceId": "<evidence id from step 3>",
     "targetId": "49bbe1be-0f06-492f-ab52-61d6bc800336",
     "invocationId": "<InvocationID>",
     "artifact": "sha256:<archive sha256>"
   }
   ```

   Each invocation can be registered once, for one changeset. When several
   Hermes PRs ship together, file the receipt for the newest one. Then file
   again with the same invocation and fresh evidence (taken within 5 minutes),
   adding `"includedChangesetIds": [...]` for the others. See ForgeGraph
   `docs/howto/kanbanger-delivery-receipts.md`.

5. **Read back** the 202 response's `eventId` and `deploymentId`
   (`manual:49bbe1be-…:<InvocationID>`), confirm
   `forge --json receipts backfill --app bob --dry-run --changeset … --expected-head …`
   no longer reports `manual_receipt_required` for `hermes-systemd`, and check
   the Kanbanger issue.

## Alerts

`hermes-health-check.py` reads `cron/jobs.json` (read-only) and today's
`Daily/YYYY-MM-DD.md`. It alerts on:

- any enabled job whose last run failed. A provider refusing the configured model
  (e.g. `HTTP 400 … model is not supported`) is called out as **model rejected**;
- the morning briefing job missing, paused, or not run for over a day;
- today's daily note missing.

Each alert is written to the journal at `alert` priority and sent to Telegram
through `hermes -p hermes-operator send -t telegram`. That is the same no-LLM path
the operator briefs use, so a rejected model cannot silence it. The unit then
exits 1, or 2 if the Telegram send itself failed.

Controlled drill (no production change). Point the check at a fixture with a
simulated rejection, and label the alert:

```bash
sudo -u bob HERMES_HOME=/home/bob/.hermes /usr/bin/python3 /opt/bob/ops/hermes-health-check.py \
  --jobs-file /tmp/simulated-jobs.json --label TEST      # add --dry-run to skip the Telegram send
```

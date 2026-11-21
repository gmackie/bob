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

Then record the delivery in ForgeGraph like other manual bob targets:
`forge evidence push` (suite `production:hetzner-bob:hermes-config`) and a
`manual_deploy` receipt via `forge integration kanbanger receipt`.

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

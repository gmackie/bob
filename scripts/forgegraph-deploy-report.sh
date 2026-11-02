#!/usr/bin/env bash
# Report this CI run's Cloudflare Worker deploy to ForgeGraph so its deploy
# history shows the commit actually serving (POST /api/fg/deploys/complete).
#
#   forgegraph-deploy-report.sh success <app> <worker> <health-url>
#   forgegraph-deploy-report.sh failed  <app> <worker> <message>
#
# `success` first proves the upload: exactly one version serves 100% of
# traffic, its FG_COMMIT_HASH binding is this commit (the stamp ForgeGraph's
# source-order guard reads before any later ForgeGraph deploy), the health URL
# answers 200, and the serving version did not change while checking. Any
# failed check, or a non-2xx callback, exits non-zero.
#
# Env: GITHUB_SHA, GITHUB_RUN_ID, GITHUB_RUN_ATTEMPT, FG_API_TOKEN (a platform
# token or this repository's deploy token), CLOUDFLARE_API_TOKEN/ACCOUNT_ID.
# WRANGLER overrides the wrangler command (default: pnpm exec wrangler).
set -euo pipefail

if [ "$#" -ne 4 ] || { [ "$1" != success ] && [ "$1" != failed ]; }; then
  echo "usage: forgegraph-deploy-report.sh success|failed <app> <worker> <health-url|message>" >&2
  exit 64
fi
status="$1" app="$2" worker="$3" detail="$4"
: "${GITHUB_SHA:?}" "${GITHUB_RUN_ID:?}" "${FG_API_TOKEN:?FG_API_TOKEN is required}"
read -r -a wrangler <<< "${WRANGLER:-pnpm exec wrangler}"

serving_version() {
  "${wrangler[@]}" deployments status --name "$worker" --json |
    node -e '
      const d = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
      const live = (d.versions ?? []).filter((v) => v.percentage > 0);
      if (live.length !== 1 || live[0].percentage !== 100 || !live[0].version_id) {
        console.error("expected exactly one Worker version serving 100% of traffic");
        process.exit(1);
      }
      process.stdout.write(live[0].version_id);
    '
}

export REPORT_STATUS="$status" REPORT_APP="$app" REPORT_WORKER="$worker"
export REPORT_EXECUTION_ID="${GITHUB_RUN_ID}:${GITHUB_RUN_ATTEMPT:-1}"
export REPORT_VERSION="" REPORT_HEALTH_URL="" REPORT_CHECKED_AT="" REPORT_MESSAGE=""

if [ "$status" = success ]; then
  REPORT_VERSION="$(serving_version)"
  "${wrangler[@]}" versions view "$REPORT_VERSION" --name "$worker" --json |
    node -e '
      const d = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
      const stamp = (d.resources?.bindings ?? []).filter(
        (b) => b.name === "FG_COMMIT_HASH" && b.type === "plain_text",
      );
      if (stamp.length !== 1 || stamp[0].text !== process.argv[1]) {
        console.error(`serving version is not stamped FG_COMMIT_HASH=${process.argv[1]}`);
        process.exit(1);
      }
    ' "$GITHUB_SHA"

  code=000
  for attempt in $(seq 1 12); do
    code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 "$detail" || true)"
    [ "$code" = 200 ] && break
    echo "health attempt $attempt: HTTP $code"
    sleep 5
  done
  if [ "$code" != 200 ]; then
    echo "::error::$detail never returned 200 (last HTTP $code)"
    exit 1
  fi
  REPORT_CHECKED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  REPORT_HEALTH_URL="$detail"

  if [ "$(serving_version)" != "$REPORT_VERSION" ]; then
    echo "::error::serving version changed during verification"
    exit 1
  fi
else
  REPORT_MESSAGE="$detail"
fi

body="$(node -e '
  const e = process.env;
  const body = {
    commitSha: e.GITHUB_SHA,
    status: e.REPORT_STATUS,
    app: e.REPORT_APP,
    workerName: e.REPORT_WORKER,
    executionId: e.REPORT_EXECUTION_ID,
  };
  if (e.REPORT_VERSION) body.workerVersion = e.REPORT_VERSION;
  if (e.REPORT_HEALTH_URL) {
    body.health = { status: "passed", checkedAt: e.REPORT_CHECKED_AT, url: e.REPORT_HEALTH_URL };
  }
  if (e.REPORT_MESSAGE) body.message = e.REPORT_MESSAGE;
  process.stdout.write(JSON.stringify(body));
')"
curl -sS --fail-with-body --retry 3 --max-time 30 \
  -X POST "${FG_SERVER:-https://forgegraf.com}/api/fg/deploys/complete" \
  -H "Authorization: Bearer ${FG_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data-binary "$body"
echo

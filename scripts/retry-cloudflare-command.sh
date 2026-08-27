#!/usr/bin/env bash

set -euo pipefail

if [ "$#" -eq 0 ]; then
  echo "usage: retry-cloudflare-command.sh <command> [args...]" >&2
  exit 64
fi

max_attempts="${CLOUDFLARE_DEPLOY_MAX_ATTEMPTS:-3}"
base_delay_seconds="${CLOUDFLARE_DEPLOY_RETRY_DELAY_SECONDS:-15}"

case "$max_attempts" in
  ''|*[!0-9]*) echo "CLOUDFLARE_DEPLOY_MAX_ATTEMPTS must be a positive integer" >&2; exit 64 ;;
esac
case "$base_delay_seconds" in
  ''|*[!0-9]*) echo "CLOUDFLARE_DEPLOY_RETRY_DELAY_SECONDS must be a non-negative integer" >&2; exit 64 ;;
esac
if [ "$max_attempts" -lt 1 ]; then
  echo "CLOUDFLARE_DEPLOY_MAX_ATTEMPTS must be a positive integer" >&2
  exit 64
fi

attempt=1
attempt_log=""
trap 'if [ -n "$attempt_log" ]; then rm -f "$attempt_log"; fi' EXIT

while [ "$attempt" -le "$max_attempts" ]; do
  attempt_log="$(mktemp "${TMPDIR:-/tmp}/cloudflare-deploy.XXXXXX")"

  set +e
  "$@" 2>&1 | tee "$attempt_log"
  command_status="${PIPESTATUS[0]}"
  set -e

  if [ "$command_status" -eq 0 ]; then
    exit 0
  fi

  if ! grep -Fq "The request to Cloudflare's API timed out." "$attempt_log"; then
    exit "$command_status"
  fi

  if [ "$attempt" -eq "$max_attempts" ]; then
    echo "Cloudflare API timed out after ${max_attempts} attempts." >&2
    exit "$command_status"
  fi

  delay_seconds=$((base_delay_seconds * attempt))
  echo "Cloudflare API timed out; retrying deploy in ${delay_seconds}s (attempt $((attempt + 1))/${max_attempts})." >&2
  rm -f "$attempt_log"
  attempt_log=""
  sleep "$delay_seconds"
  attempt=$((attempt + 1))
done

#!/usr/bin/env bash
# Preflight: verify the workspace is actually buildable before a deploy burns
# three attempts on it. Catches the shared-node_modules churn that silently
# breaks the deploy build — dangling @bob/* workspace links and a missing
# vinext bin — when a concurrent filtered install reshapes an off-volume,
# shared node_modules. Exits nonzero with a clear fix so callers can gate.
#
#   pnpm --filter bob run preflight   (or: bash scripts/preflight-deploy.sh)
set -uo pipefail
cd "$(dirname "$0")/.." # repo root

fail=0

# 1. Is the deploy tool (vinext) resolvable from apps/bob?
if (cd apps/bob && pnpm exec vinext --version >/dev/null 2>&1); then
  echo "  ok   vinext present ($(cd apps/bob && pnpm exec vinext --version 2>/dev/null))"
else
  echo "  FAIL vinext not resolvable — node_modules churned. Fix: pnpm install --force"
  fail=1
fi

# 2. Do the @bob/* workspace links resolve to real source (not a dangling
#    off-volume path)? tsconfig extends @bob/tsconfig/base.json at build time.
node -e '
  const fs = require("fs");
  const p = "apps/bob/node_modules/@bob/tsconfig/base.json";
  if (!fs.existsSync(p)) {
    console.log("  FAIL @bob/tsconfig/base.json missing — workspace links broken. Fix: pnpm install --force");
    process.exit(1);
  }
  console.log("  ok   @bob/tsconfig -> " + fs.realpathSync(p));
' || fail=1

# 3. node_modules present at all?
if [ -e node_modules ]; then
  echo "  ok   node_modules present ($([ -L node_modules ] && echo "symlinked off-volume — shared, churn-prone" || echo "local, isolated"))"
else
  echo "  FAIL no node_modules — run: pnpm install"
  fail=1
fi

if [ "$fail" -eq 0 ]; then
  echo "preflight: workspace is buildable."
else
  echo "preflight: workspace is NOT buildable — deploy would fail. See fixes above." >&2
fi
exit "$fail"

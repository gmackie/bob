# gmacko-mini OODA Runner

Use this when Bob needs a macOS-capable execution node and/or a t3code-backed
runner that appears in the Bob Nodes UI.

As of 2026-06-17, `gmacko-mini` is registered with production OODA at
`https://ooda.blder.bot` as a macOS runner with `codex`, `claude`, and
`cursor-agent` adapter capabilities. Bob heartbeat reporting and t3code dispatch
are enabled when the Bob public API and t3code environment variables below are
supplied.

The active checkout on `gmacko-mini` is:

```txt
/Users/mackieg/src/bob
```

Do not point the runner at `~/dev/bob` or `/Volumes/dev/bob` on this host unless
`/Volumes/dev` is mounted. On 2026-06-17, `~/dev` was a broken symlink to
`/Volumes/dev`, which caused launchd to restart the runner with `EX_CONFIG`.

## Environment

Configure the runner process on `gmacko-mini` with:

```sh
OODA_RUNNER_NAME=gmacko-mini
OODA_SERVER_URL=https://ooda.blder.bot
OODA_RUNNER_SECRET=<gmacko-mini-runner-secret>

BOB_API_URL=https://<bob-server>
BOB_API_KEY=<bob-public-api-key>
BOB_WORKSPACE_ID=<bob-workspace-id-for-this-node>
BOB_DEV_DIR=/Users/mackieg/src
BOB_MAX_CONCURRENT=4

OODA_T3CODE_SERVER_URL=http://127.0.0.1:3774
OODA_T3CODE_PROJECT_ID=<t3code-project-id>
OODA_T3CODE_MODEL_INSTANCE_ID=codex
OODA_T3CODE_MODEL=gpt-5.4
OODA_T3CODE_AUTH_TOKEN=<t3code-token>
OODA_T3CODE_WORKTREE_PATH=/Users/mackieg/src/bob
OODA_T3CODE_RUNTIME_MODE=full-access
```

The runner also accepts unprefixed `T3CODE_*` fallbacks, but the production
`gmacko-mini` env file uses `OODA_T3CODE_*` to keep these values scoped to the
OODA runner.
`OODA_T3CODE_WORKTREE_PATH` should point at a checkout visible to the T3
backend serving `OODA_T3CODE_SERVER_URL`; with the current reverse tunnel,
`/Users/mackieg/src/bob` exists on both sides of the tunnel.

Production OODA accepts `OODA_RUNNER_ADDITIONAL_SECRETS`, so `gmacko-mini` can
use its own runner secret without rotating the existing Hetzner runner secret.
Keep that value only in Cloudflare Worker secrets and the local runner env file.

`OODA_RUNNER_NAME=gmacko-mini` is the stable node name shown in Bob. On macOS,
the runner advertises `macos` and `darwin` alongside adapter capabilities like
`codex`, `claude`, and `cursor-agent`. Bob heartbeat reporting stores the same
platform capabilities for `/nodes`.

Cursor execution depends on the `cursor-agent` binary being available on the
runner `PATH`. Over SSH, `cursor-agent` can fail if the macOS login keychain is
locked; unlock the keychain in the active macOS session before relying on Cursor
jobs.

## OODA Edge Binding

Production OODA must point at the Bob database Hyperdrive config:

```txt
HYPERDRIVE=c1f467f772dc4ce99d99e572df74c121
```

The old `b053c840acb441e3b80608c686204b97` config is missing and causes OODA
runner registration and list calls to fail at the database layer.

## Start

From this repo:

```sh
pnpm -F @gmacko/ooda-runner start
```

For local verification before installing a service:

```sh
pnpm -F @gmacko/ooda-runner dev
```

## macOS LaunchAgent

Install the runner as a per-user LaunchAgent on `gmacko-mini`:

```txt
~/Library/LaunchAgents/com.gmacko.ooda-runner.plist
~/.local/bin/ooda-runner-loop.sh
~/.config/ooda-runner/gmacko-mini.env
```

The env file should be `chmod 600`. The wrapper must export sourced variables
before starting `pnpm`:

```sh
#!/usr/bin/env zsh
set -euo pipefail
set -a
source "$HOME/.config/ooda-runner/gmacko-mini.env"
set +a
cd /Users/mackieg/src/bob
exec /opt/homebrew/bin/pnpm -F @gmacko/ooda-runner start
```

Include a non-interactive-safe path in the env file:

```sh
PATH=$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
```

## Verify

1. Confirm the runner is loaded:
   `launchctl print gui/501/com.gmacko.ooda-runner`
2. Confirm the runner log shows registration and available adapters:
   `tail -n 40 ~/Library/Logs/ooda-runner.out.log`
3. Confirm OODA lists `gmacko-mini` with a recent heartbeat and capabilities:
   `codex, claude, cursor-agent, macos, darwin`.
4. In Bob, open `/nodes`.
5. Confirm the `gmacko-mini` node shows a recent heartbeat.
6. Confirm the runtime column shows `macOS`.
7. If t3code env vars are complete, confirm it shows `t3code online`.
8. Open the node detail page and confirm the t3code endpoint/model/runtime mode
   match the configured values.

Useful direct checks:

```sh
launchctl print "gui/$(id -u)/com.gmacko.ooda-runner" | grep -E "state =|pid =|last exit|working directory"
tail -n 20 ~/Library/Logs/ooda-runner.out.log
curl -sS "https://ooda.blder.bot/api/trpc/runner.listDevices?batch=1&input=%7B%7D"
```

To verify the t3code token from `gmacko-mini` without printing it:

```sh
set -a
source ~/.config/ooda-runner/gmacko-mini.env
set +a
curl -sS -o /tmp/t3auth.out -w "%{http_code}\n" \
  -H "Authorization: Bearer $OODA_T3CODE_AUTH_TOKEN" \
  "$OODA_T3CODE_SERVER_URL/api/auth/session"
head -c 300 /tmp/t3auth.out
```

## Routing Contract

OODA runner registration includes host platform capabilities, so a macOS runner
registers with:

```txt
codex, claude, cursor-agent, macos, darwin
```

OODA `runner.sendPrompt` accepts `requiredCapabilities`. Calls that include:

```ts
requiredCapabilities: ["macos"]
```

are rejected if the selected runner does not advertise `macos`. This prevents a
macOS-only task from being queued to a Linux runner by mistake.

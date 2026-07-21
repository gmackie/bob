# Multi-provider execution host setup

Bob keeps provider credentials on each execution host. Perform installation and
authentication as the `bob` service user; root's credentials do not count.

## Install and authenticate

```bash
sudo -iu bob
claude auth login
codex login
grok login --device-auth
cursor-agent login
```

Install missing CLIs from their official distribution channels before login.
The service reads `/opt/bob/execution-daemon/.env`; it needs `BOB_API_KEY`,
`BOB_WORKSPACE_ID`, `GATEWAY_WS_URL`, and `BOB_DEV_DIR`, but no provider secret
is copied into Bob when browser/device authentication is used.

Deploy and inspect the host:

```bash
apps/bob-execution/deploy-hetzner-bob.sh hetzner-bob root
node scripts/verify-bob-provider-host.mjs hetzner-bob root
```

The verifier fails when the service is inactive, the gateway heartbeat is
stale, a CLI is absent, or a CLI is not authenticated as `bob`. It never prints
account identifiers, access tokens, or CLI credential files.

## End-to-end acceptance

For each provider, create a harmless task that reads the repository and returns
its current branch. Confirm the run streams through `bob.blder.bot`, reaches a
terminal state, and records Bob-observed tokens. Separately prove one stop and
one daemon reconnect/replay. Record service versions and sanitized results here
when deploying a host.

Repeat the same installation and verifier for `vanuc` and `labnuc`; only the
registered host credential, workspace, and repository allowlist differ.

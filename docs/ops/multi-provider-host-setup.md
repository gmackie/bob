# Multi-provider execution host setup

Production inference uses CLIProxy on labnuc. A failed direct `codex login
status` check does not prove the proxy is unavailable and must not trigger a
new device-login request.

Before configuring a host, identify the service that owns its Bob gateway
connection. On the inspected production host, `ooda-runner.service` owns that
connection; the legacy `bob-execution.service` uses the same workspace and
must not run alongside it (the gateway reports `SUPERSEDED`).

## CLIProxy path

The host-managed `/etc/cli-proxy/client.env` supplies the proxy endpoint and
credentials. Load it into the actual execution service, not only a shell or
an inactive legacy service. Never print or commit its values.

Codex needs an explicit Responses provider configuration, with `base_url`
matching `OPENAI_BASE_URL`, `wire_api = "responses"`,
`env_key = "OPENAI_API_KEY"`, and `requires_openai_auth = false`.
Select that provider with `model_provider`. Verify with a harmless read-only
Codex invocation under the service user and service environment. Listing
proxy models alone does not prove inference works.

The isolated Codex adapter strips `OPENAI_API_KEY` for subscription-mode
invocations. Preserve that protection against accidental metered fallback;
proxy-backed execution needs explicit configuration through the active
runner's credential boundary before rollout. Do not change the shared Codex
configuration while active runners lack the corresponding environment.

For local journals on a mounted volume, ensure the directory exists and the
systemd service has `RequiresMountsFor` and `ReadWritePaths` for the resolved
volume path, including when the home-directory path is a symlink.

## Direct-provider installations

The commands below apply only when intentionally using direct provider
login rather than CLIProxy. Run them as the service user; root's credentials
do not count.

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

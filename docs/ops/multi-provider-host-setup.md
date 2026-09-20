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
`env_key = "CLIPROXY_API_KEY"`, and `requires_openai_auth = false`.
Select that provider with `model_provider`. Verify with a harmless read-only
Codex invocation under the service user and service environment. Listing
proxy models alone does not prove inference works.

The dedicated `CLIPROXY_API_KEY` identifies the host-managed proxy credential.
The Codex adapter continues to strip `OPENAI_API_KEY` for subscription-mode
invocations, preserving protection against accidental direct metered fallback.
Bob gateway execution inherits the active runner environment. Isolated OODA
agent jobs use a separate credential broker and must be configured independently.
Do not change the shared Codex configuration while active runners lack the
corresponding environment.

Production verification on 2026-09-17: the active OODA runner loaded the proxy
credential file, a Codex probe under its exact environment succeeded, and Bob's
Effect-dispatched acceptance work completed with the expected model response.
The legacy execution daemon remains stopped to avoid duplicate gateway claims.

For local journals on a mounted volume, ensure the directory exists and the
systemd service has `RequiresMountsFor` and `ReadWritePaths` for the resolved
volume path, including when the home-directory path is a symlink.

## Direct-provider installations

The commands below apply only when intentionally using direct provider
login rather than CLIProxy. Run them as the service user; root's credentials
do not count.

## Bob-managed proxy routing (runner ≥ this change)

The runner now resolves the proxy itself from the same env file, so isolated
OODA agent jobs and host turns use it too — previously only gateway sessions
did, and only because the host environment happened to carry the variables.

Variables the runner reads (from `/etc/cli-proxy/client.env` or the runner's
own env file; never print or commit their values):

| Variable | Meaning |
|---|---|
| `CLIPROXY_BASE_URL` | Proxy origin. Required for proxy routing. |
| `CLIPROXY_API_KEY` | Proxy API key. Required for proxy routing. |
| `BOB_PROVIDER_AUTH_MODE` | `proxy` (default when a route exists), `subscription`, or `api_key`. |
| `BOB_PROVIDER_AUTH_MODE_<PROVIDER>` | Per-provider override, e.g. `BOB_PROVIDER_AUTH_MODE_CLAUDE=subscription`. |

What changes when a provider is routed through the proxy:

- Claude runs get `ANTHROPIC_BASE_URL` and `ANTHROPIC_AUTH_TOKEN` derived from
  the route. The host's own `ANTHROPIC_BASE_URL` is not trusted, so the two
  cannot drift apart silently.
- Codex runs get `OPENAI_BASE_URL` and `CLIPROXY_API_KEY`, plus a per-run
  `CODEX_HOME/config.toml` selecting the `cliproxy` Responses provider. The
  shared `~/.codex/config.toml` is no longer required for Bob-managed runs and
  is never edited by the runner.
- No OAuth credential file is copied for a proxied provider.
- The health probe asks the proxy (`GET /v1/models` with the key) instead of
  the host login state. A proxy that cannot be reached reports
  `proxy_unreachable` with the remedy "check proxy" — not "install" and not
  "sign in". Grok and Cursor have no proxy transport and stay host-probed.

The host `adapter-cred-health` unit probes host-local OAuth state and is
therefore wrong for proxied providers; retire it once the runner is deployed
with this change and confirm the Nodes page shows `via: proxy` for Claude and
Codex.

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

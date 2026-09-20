/**
 * Inference-proxy routing for subscription runs.
 *
 * Production inference goes through CLIProxyAPI: the proxy holds the Claude and
 * Codex subscription accounts, and the CLIs are pointed at it with a base URL
 * and a bearer key. Until now that wiring lived only in a host-managed env
 * file and the host's shared Codex config, and the isolated-job broker forwarded
 * neither — so OODA jobs kept copying OAuth credential files per run while
 * gateway sessions on the same host used the proxy. This module makes the
 * route a first-class, testable input.
 *
 * The resolvers are shared with the execution daemon and the agent-health CLI
 * (`@bob/execution/providers`) so the probe and the run cannot disagree about
 * whether a host is on the proxy. What lives here is the run-side half: the
 * environment a CLI needs, and the per-run Codex config.
 */

import type { ProxyRoute } from "@bob/execution/providers";

export {
  proxySupportsProvider,
  resolveProviderAuthPreference,
  resolveProxyRoute,
  type ProviderAuthPreference,
  type ProxyRoute,
} from "@bob/execution/providers";

/**
 * The environment a CLI needs to talk to the proxy. Claude takes a bearer token
 * (`ANTHROPIC_AUTH_TOKEN`), which its adapter does not strip; Codex reads the
 * key through the `env_key` named in its provider config, so the variable name
 * here and in {@link renderCodexProxyConfig} must agree.
 */
export function proxyEnvironmentFor(
  provider: string,
  route: ProxyRoute,
): Record<string, string> | undefined {
  if (provider === "claude") {
    return { ANTHROPIC_BASE_URL: route.baseUrl, ANTHROPIC_AUTH_TOKEN: route.apiKey };
  }
  if (provider === "codex" || provider === "openai") {
    return { OPENAI_BASE_URL: `${route.baseUrl}/v1`, CLIPROXY_API_KEY: route.apiKey };
  }
  return undefined;
}

/**
 * Per-run Codex config selecting the proxy as its Responses provider. Written
 * into the run's own CODEX_HOME so the host's shared config is never edited —
 * the runbook is explicit that changing it under active runners breaks them.
 * Mirrors the block the runbook specifies; the key is referenced by name only.
 */
export function renderCodexProxyConfig(route: ProxyRoute): string {
  return [
    'model_provider = "cliproxy"',
    "",
    "[model_providers.cliproxy]",
    'name = "CLIProxy (Bob-managed run)"',
    `base_url = "${route.baseUrl}/v1"`,
    'wire_api = "responses"',
    'env_key = "CLIPROXY_API_KEY"',
    "requires_openai_auth = false",
    "",
  ].join("\n");
}

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
 * The proxy is a *transport* of the subscription auth mode, not a third mode:
 * the accounts behind it are subscriptions, the billing policy is unchanged,
 * and the adapters' metered-key stripping still applies.
 */

export type ProxyRoute = {
  /** Origin of the proxy, no trailing slash. */
  baseUrl: string;
  /** Proxy API key; presented as a bearer token to the proxy, never logged. */
  apiKey: string;
};

export type ProviderAuthPreference = "proxy" | "subscription" | "api_key";

type Source = Record<string, string | undefined>;

const PREFERENCES = new Set<ProviderAuthPreference>(["proxy", "subscription", "api_key"]);

const PROXY_PROVIDERS = new Set(["claude", "codex", "openai"]);

function trimmed(value: string | undefined): string | undefined {
  const text = value?.trim();
  return text ? text : undefined;
}

/** Both halves are required: a URL without a key 401s, a key without a URL is ignored. */
export function resolveProxyRoute(source: Source): ProxyRoute | undefined {
  const baseUrl = trimmed(source.CLIPROXY_BASE_URL)?.replace(/\/+$/, "");
  const apiKey = trimmed(source.CLIPROXY_API_KEY);
  if (!baseUrl || !apiKey) return undefined;
  return { baseUrl, apiKey };
}

/** The CLIs that honour a base URL. Grok's CLI has no proxy transport here. */
export function proxySupportsProvider(provider: string): boolean {
  return PROXY_PROVIDERS.has(provider);
}

function parsePreference(value: string | undefined): ProviderAuthPreference | undefined {
  const text = trimmed(value)?.toLowerCase();
  return text && PREFERENCES.has(text as ProviderAuthPreference)
    ? (text as ProviderAuthPreference)
    : undefined;
}

/**
 * Most specific wins: `BOB_PROVIDER_AUTH_MODE_<PROVIDER>`, then
 * `BOB_PROVIDER_AUTH_MODE`, then "proxy" when a route exists, else
 * "subscription". Unrecognised values are ignored rather than guessed at, and
 * "proxy" is never returned for a provider the proxy cannot serve.
 */
export function resolveProviderAuthPreference(
  provider: string,
  source: Source,
): ProviderAuthPreference {
  const perProvider = parsePreference(
    source[`BOB_PROVIDER_AUTH_MODE_${provider.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`],
  );
  const global = parsePreference(source.BOB_PROVIDER_AUTH_MODE);
  const fallback: ProviderAuthPreference = resolveProxyRoute(source) ? "proxy" : "subscription";
  const chosen = perProvider ?? global ?? fallback;
  if (chosen === "proxy" && !proxySupportsProvider(provider)) return "subscription";
  return chosen;
}

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

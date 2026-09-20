/**
 * Inference-proxy routing, shared by everything that probes or runs a provider
 * CLI: the runner's credential surface, the execution daemon, the agent-health
 * CLI, and the runner's job broker. One resolver so they cannot disagree about
 * whether a host is on the proxy.
 *
 * The proxy is a transport of the subscription auth mode, not a third mode:
 * the accounts behind it are subscriptions and the billing policy is unchanged.
 */

import type { ProbeOptions } from "./cli-provider.js";

export type ProxyRoute = {
  /** Origin of the proxy, no trailing slash. */
  baseUrl: string;
  /** Proxy API key; presented as a bearer token, never logged. */
  apiKey: string;
};

export type ProviderAuthPreference = "proxy" | "subscription" | "api_key";

type Source = Record<string, string | undefined>;

const PREFERENCES = new Set<ProviderAuthPreference>(["proxy", "subscription", "api_key"]);

/** The CLIs that honour a base URL. Grok's and Cursor's have no proxy transport here. */
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
 * Probe options for a provider on this host: the proxy route when the provider
 * is routed through it, nothing otherwise (host-local probe). `fetch` is
 * injectable so the callers' tests stay deterministic.
 */
export function probeOptionsFor(
  provider: string,
  source: Source,
  fetchImpl?: typeof fetch,
): ProbeOptions {
  const route = resolveProxyRoute(source);
  if (!route || resolveProviderAuthPreference(provider, source) !== "proxy") return {};
  return { proxy: { ...route, ...(fetchImpl ? { fetch: fetchImpl } : {}) } };
}

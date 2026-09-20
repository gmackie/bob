import type { ProviderCapabilities, ProviderHealthSnapshot, ProviderId } from "./contract.js";
import type { LatchedOutcome } from "./credit.js";
import { redactDetail } from "./credit.js";

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type RunCommand = (command: string, args: string[]) => Promise<CommandResult>;

/**
 * Where inference actually goes. When set, the auth half of the probe asks the
 * proxy instead of the host-local CLI login state — on the production runner
 * those two disagreed, and the host answer was the wrong one.
 */
export interface ProxyProbeRoute {
  baseUrl: string;
  apiKey: string;
  /** Injectable for tests; defaults to the global fetch. */
  fetch?: typeof fetch;
}

export interface ProbeOptions {
  proxy?: ProxyProbeRoute;
}

/** Providers whose CLIs honour a base URL, so the proxy can serve them. */
const proxyProviders: ReadonlySet<ProviderId> = new Set<ProviderId>(["claude", "codex"]);

/** A model id prefix that proves the proxy is configured for the provider. */
const proxyModelPrefixes: Partial<Record<ProviderId, readonly string[]>> = {
  claude: ["claude"],
  codex: ["gpt", "codex", "o1", "o3", "o4"],
};

const PROXY_PROBE_TIMEOUT_MS = 8_000;

type ProxyProbeResult =
  | { kind: "ok" }
  | { kind: "no_models" }
  | { kind: "rejected"; detail: string }
  | { kind: "unreachable"; detail: string };

async function probeProxy(provider: ProviderId, route: ProxyProbeRoute): Promise<ProxyProbeResult> {
  const doFetch = route.fetch ?? fetch;
  const url = `${route.baseUrl.replace(/\/+$/, "")}/v1/models`;
  let response: Response;
  try {
    response = await doFetch(url, {
      headers: { authorization: `Bearer ${route.apiKey}` },
      signal: AbortSignal.timeout(PROXY_PROBE_TIMEOUT_MS),
    });
  } catch (error) {
    return { kind: "unreachable", detail: error instanceof Error ? error.message : "request failed" };
  }
  if (response.status === 401 || response.status === 403) {
    return { kind: "rejected", detail: `HTTP ${response.status}` };
  }
  if (!response.ok) {
    return { kind: "unreachable", detail: `HTTP ${response.status}` };
  }
  let ids: string[] = [];
  try {
    const body = (await response.json()) as { data?: Array<{ id?: unknown }> };
    ids = (body.data ?? []).map((m) => (typeof m.id === "string" ? m.id : "")).filter(Boolean);
  } catch {
    return { kind: "unreachable", detail: "malformed model list" };
  }
  const prefixes = proxyModelPrefixes[provider] ?? [];
  const served = ids.some((id) => prefixes.some((prefix) => id.toLowerCase().startsWith(prefix)));
  return served ? { kind: "ok" } : { kind: "no_models" };
}

const providerCommands: Record<ProviderId, string> = {
  claude: "claude",
  codex: "codex",
  grok: "grok",
  "cursor-agent": "cursor-agent",
};

const authArgs: Record<ProviderId, string[]> = {
  claude: ["auth", "status"],
  codex: ["login", "status"],
  grok: ["models"],
  "cursor-agent": ["status"],
};

const capabilities: Record<ProviderId, ProviderCapabilities> = {
  claude: {
    approval: true, followUp: true, resume: true, cancel: true, structuredUsage: true,
    providerAllowance: false, providerResetAt: false, directCost: true, modelIdentity: true,
  },
  codex: {
    approval: true, followUp: true, resume: true, cancel: true, structuredUsage: true,
    providerAllowance: false, providerResetAt: false, directCost: false, modelIdentity: true,
  },
  grok: {
    approval: true, followUp: true, resume: false, cancel: true, structuredUsage: true,
    providerAllowance: false, providerResetAt: false, directCost: false, modelIdentity: true,
  },
  "cursor-agent": {
    approval: true, followUp: true, resume: true, cancel: true, structuredUsage: true,
    providerAllowance: false, providerResetAt: false, directCost: false, modelIdentity: true,
  },
};

/**
 * Probe a provider CLI.
 *
 * The probe is an ESTIMATE. A real run outcome is proof, and where they
 * disagree the outcome wins.
 *
 * It cannot see credit: `grok models` exits 0 on an authenticated account with
 * an exhausted balance, which is why the 2026-08-29 outage reported a healthy
 * agent that 402'd on every dispatch. It is not reliable on auth either — on
 * 2026-08-30 codex probed Ready while every run died on `401 Unauthorized`,
 * and cursor probed Ready while every run died on "Authentication required".
 * And it cannot see a quota: claude probed Ready against a spent weekly cap.
 *
 * So `latched` — set from real run outcomes by RunOutcomeLatch — overrides a
 * clean probe, and carries WHICH failure it was so the UI can offer the right
 * remedy: top up, sign in, or wait.
 */
export async function probeCliProvider(
  provider: ProviderId,
  run: RunCommand,
  now = new Date(),
  latched: LatchedOutcome = {},
  options: ProbeOptions = {},
): Promise<ProviderHealthSnapshot> {
  const command = providerCommands[provider];
  const viaProxy = Boolean(options.proxy) && proxyProviders.has(provider);
  const base = {
    provider,
    command,
    capabilities: capabilities[provider],
    checkedAt: now.toISOString(),
    via: viaProxy ? ("proxy" as const) : ("host" as const),
  };

  try {
    const version = await run(command, ["--version"]);
    if (version.code !== 0) {
      return { ...base, installed: false, authenticated: false, status: "unavailable", error: "version probe failed" };
    }
    const installed = { ...base, installed: true, version: version.stdout.trim() || undefined };

    if (viaProxy && options.proxy) {
      // The proxy holds the accounts; the host's own login state is irrelevant
      // and, on the production runner, actively misleading. Ask the proxy.
      const proxy = await probeProxy(provider, options.proxy);
      if (proxy.kind === "unreachable") {
        return {
          ...installed,
          authenticated: false,
          status: "proxy_unreachable",
          error: "inference proxy unreachable",
          detail: redactDetail(proxy.detail) || undefined,
        };
      }
      if (proxy.kind === "rejected") {
        return {
          ...installed,
          authenticated: false,
          status: "unauthenticated",
          error: "inference proxy rejected the key",
          detail: proxy.detail,
        };
      }
      if (proxy.kind === "no_models") {
        // Uncertain, not confirmed dead: a proxy with no models for this
        // provider is a configuration gap, and dispatch may still try.
        return {
          ...installed,
          authenticated: true,
          status: "degraded",
          error: `inference proxy lists no ${provider} models`,
        };
      }
    } else {
      const auth = await run(command, authArgs[provider]);
      if (auth.code !== 0) {
        // Auth outranks credit: an unreachable account cannot spend a balance,
        // and "sign in" is the correct next action either way.
        return {
          ...installed,
          authenticated: false,
          status: "unauthenticated",
          error: "authentication probe failed",
          detail: redactDetail(`${auth.stderr}\n${auth.stdout}`) || undefined,
        };
      }
    }
    // A clean probe does not clear a latched outcome: the probe is exactly
    // what was wrong in both outages.
    if (latched.kind) {
      const asStatus = {
        no_credit: "no_credit",
        auth: "unauthenticated",
        rate_limited: "rate_limited",
      } as const;
      const why = {
        no_credit: "provider reported an exhausted balance",
        auth: "a real run failed to authenticate",
        rate_limited: "provider reported a rate or quota limit",
      } as const;
      return {
        ...base,
        installed: true,
        authenticated: latched.kind !== "auth",
        version: version.stdout.trim() || undefined,
        status: asStatus[latched.kind],
        error: why[latched.kind],
        detail: latched.detail,
      };
    }
    return {
      ...base,
      installed: true,
      authenticated: true,
      version: version.stdout.trim() || undefined,
      status: "ready",
    };
  } catch (error) {
    return {
      ...base,
      installed: false,
      authenticated: false,
      status: "unavailable",
      error: error instanceof Error && error.message.includes("ENOENT") ? "command not found" : "probe failed",
    };
  }
}

import { describe, expect, it } from "vitest";

import {
  proxyEnvironmentFor,
  proxySupportsProvider,
  renderCodexProxyConfig,
  resolveProviderAuthPreference,
  resolveProxyRoute,
} from "../proxy-route";

const route = {
  CLIPROXY_BASE_URL: "http://proxy.internal:8317/",
  CLIPROXY_API_KEY: "proxy-key",
};

describe("resolveProxyRoute", () => {
  it("reads the proxy endpoint and key from the runner environment", () => {
    expect(resolveProxyRoute(route)).toEqual({
      baseUrl: "http://proxy.internal:8317",
      apiKey: "proxy-key",
    });
  });

  it("is absent unless both the endpoint and the key are present", () => {
    // Half a route is worse than none: a base URL without a key produces 401s
    // on every run, and a key without a URL is silently ignored by the CLIs.
    expect(resolveProxyRoute({ CLIPROXY_BASE_URL: route.CLIPROXY_BASE_URL })).toBeUndefined();
    expect(resolveProxyRoute({ CLIPROXY_API_KEY: "proxy-key" })).toBeUndefined();
    expect(resolveProxyRoute({})).toBeUndefined();
    expect(resolveProxyRoute({ CLIPROXY_BASE_URL: "  ", CLIPROXY_API_KEY: "k" })).toBeUndefined();
  });
});

describe("resolveProviderAuthPreference", () => {
  it("defaults to the proxy when a route is configured, subscription otherwise", () => {
    expect(resolveProviderAuthPreference("claude", route)).toBe("proxy");
    expect(resolveProviderAuthPreference("claude", {})).toBe("subscription");
  });

  it("honours a global override and a per-provider override, most specific first", () => {
    expect(
      resolveProviderAuthPreference("claude", { ...route, BOB_PROVIDER_AUTH_MODE: "subscription" }),
    ).toBe("subscription");
    expect(
      resolveProviderAuthPreference("codex", {
        ...route,
        BOB_PROVIDER_AUTH_MODE: "subscription",
        BOB_PROVIDER_AUTH_MODE_CODEX: "proxy",
      }),
    ).toBe("proxy");
  });

  it("ignores an unrecognised value rather than picking a mode by accident", () => {
    expect(resolveProviderAuthPreference("claude", { ...route, BOB_PROVIDER_AUTH_MODE: "cloud" })).toBe(
      "proxy",
    );
  });

  it("never selects the proxy for a provider the proxy cannot serve", () => {
    // Grok has no proxy transport in this runner; asking for it must not
    // strand the run with an empty environment.
    expect(resolveProviderAuthPreference("grok", route)).toBe("subscription");
  });
});

describe("proxySupportsProvider", () => {
  it("covers the two CLIs that honour a base URL", () => {
    expect(proxySupportsProvider("claude")).toBe(true);
    expect(proxySupportsProvider("codex")).toBe(true);
    expect(proxySupportsProvider("openai")).toBe(true);
    expect(proxySupportsProvider("grok")).toBe(false);
  });
});

describe("proxyEnvironmentFor", () => {
  const resolved = { baseUrl: "http://proxy.internal:8317", apiKey: "proxy-key" };

  it("points the Claude CLI at the proxy with a bearer token, not an API key", () => {
    expect(proxyEnvironmentFor("claude", resolved)).toEqual({
      ANTHROPIC_BASE_URL: "http://proxy.internal:8317",
      ANTHROPIC_AUTH_TOKEN: "proxy-key",
    });
  });

  it("points Codex at the OpenAI-compatible surface and names the key the config expects", () => {
    // Codex reads the key through `env_key` in its provider config, so the
    // variable name must match what renderCodexProxyConfig writes.
    expect(proxyEnvironmentFor("codex", resolved)).toEqual({
      OPENAI_BASE_URL: "http://proxy.internal:8317/v1",
      CLIPROXY_API_KEY: "proxy-key",
    });
    expect(proxyEnvironmentFor("openai", resolved)).toEqual(proxyEnvironmentFor("codex", resolved));
  });

  it("returns nothing for an unsupported provider", () => {
    expect(proxyEnvironmentFor("grok", resolved)).toBeUndefined();
  });
});

describe("renderCodexProxyConfig", () => {
  it("renders the provider block the host runbook specifies, and selects it", () => {
    const toml = renderCodexProxyConfig({ baseUrl: "http://proxy.internal:8317", apiKey: "k" });
    expect(toml).toMatch(/^model_provider = "cliproxy"$/m);
    expect(toml).toMatch(/^\[model_providers\.cliproxy\]$/m);
    expect(toml).toMatch(/^base_url = "http:\/\/proxy\.internal:8317\/v1"$/m);
    expect(toml).toMatch(/^wire_api = "responses"$/m);
    expect(toml).toMatch(/^env_key = "CLIPROXY_API_KEY"$/m);
    expect(toml).toMatch(/^requires_openai_auth = false$/m);
  });

  it("never embeds the key itself", () => {
    expect(renderCodexProxyConfig({ baseUrl: "http://p", apiKey: "super-secret" })).not.toContain(
      "super-secret",
    );
  });
});

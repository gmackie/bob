import { describe, expect, it, vi } from "vitest";

import {
  createHermesBootstrapRequest,
  createHermesNativeApiRequest,
  createHermesProxyRequest,
  extractHermesSessionToken,
  fetchHermesOverview,
  getHermesLoginRedirect,
  isAuthorizedHermesOperator,
  isAllowedHermesProxyServiceRequest,
  isHermesNativeApiPath,
  isHermesProxyPath,
  sanitizeHermesResponse,
  validateHermesBrowserRequest,
  validateHermesNativeApiMutation,
} from "./hermes-proxy";

const PROXY_TOKEN = "bob-hermes-proxy-secret";

describe("Hermes proxy boundary", () => {
  it("matches only the dedicated dashboard and native API paths", () => {
    expect(isHermesProxyPath("/hermes")).toBe(true);
    expect(isHermesProxyPath("/hermes/sessions?profile=coder")).toBe(true);
    expect(isHermesProxyPath("/hermetic")).toBe(false);
    expect(isHermesNativeApiPath("/api/hermes/status")).toBe(true);
    expect(isHermesNativeApiPath("/api/hermes")).toBe(false);
    expect(isHermesNativeApiPath("/hermes/api/status")).toBe(false);
  });

  it("allows the separate proxy credential only on Hermes paths and normal HTTP methods", () => {
    expect(isAllowedHermesProxyServiceRequest("GET", "/hermes/")).toBe(true);
    expect(
      isAllowedHermesProxyServiceRequest(
        "PUT",
        "/hermes/api/messaging/platforms/telegram",
      ),
    ).toBe(true);
    expect(
      isAllowedHermesProxyServiceRequest("CONNECT", "/hermes/api/status"),
    ).toBe(false);
    expect(
      isAllowedHermesProxyServiceRequest("GET", "/hermes/../api/config"),
    ).toBe(false);
    expect(isAllowedHermesProxyServiceRequest("GET", "/api/config")).toBe(
      false,
    );
  });

  it("builds HTTPS-only upstream requests and replaces browser authorization", () => {
    const incoming = new Request(
      "https://bob.blder.bot/hermes/api/config?profile=coder",
      {
        headers: {
          authorization: "Bearer browser-token",
          cookie: "better-auth.session_token=valid",
        },
      },
    );
    const proxied = createHermesProxyRequest(
      incoming,
      "https://claude.gmac.io",
      PROXY_TOKEN,
    );
    expect(proxied.url).toBe(
      "https://claude.gmac.io/hermes/api/config?profile=coder",
    );
    expect(proxied.headers.get("authorization")).toBe(`Bearer ${PROXY_TOKEN}`);
    expect(proxied.headers.has("cookie")).toBe(false);
    expect(() =>
      createHermesProxyRequest(incoming, "http://127.0.0.1:9119", PROXY_TOKEN),
    ).toThrow(/HTTPS/);
    expect(() =>
      createHermesProxyRequest(
        incoming,
        "https://example.com/path",
        PROXY_TOKEN,
      ),
    ).toThrow(/origin/);
  });

  it("fails closed for users outside the configured Hermes operator allowlist", () => {
    expect(isAuthorizedHermesOperator("graham", "graham,operator-2")).toBe(
      true,
    );
    expect(isAuthorizedHermesOperator("other-user", "graham,operator-2")).toBe(
      false,
    );
    expect(isAuthorizedHermesOperator("graham", "")).toBe(false);
    expect(isAuthorizedHermesOperator("operator-2", " graham, operator-2 ")).toBe(
      true,
    );
  });

  it("rejects cross-origin mutations and unsupported methods", () => {
    expect(
      validateHermesBrowserRequest(
        new Request("https://bob.blder.bot/api/hermes/cron/jobs/a/trigger", {
          method: "POST",
          headers: { origin: "https://evil.blder.bot" },
        }),
      ),
    ).toEqual(expect.objectContaining({ status: 403 }));
    expect(
      validateHermesBrowserRequest(
        new Request("https://bob.blder.bot/api/hermes/cron/jobs/a/trigger", {
          method: "POST",
          headers: { origin: "https://bob.blder.bot" },
        }),
      ),
    ).toBeNull();
    expect(
      validateHermesBrowserRequest(
        new Request("https://bob.blder.bot/hermes/api/status"),
      ),
    ).toBeNull();
    expect(
      validateHermesBrowserRequest(
        new Request("https://bob.blder.bot/hermes/ws", {
          headers: {
            origin: "https://bob.blder.bot",
            upgrade: "websocket",
          },
        }),
      ),
    ).toBeNull();
    expect(
      validateHermesBrowserRequest(
        new Request("https://bob.blder.bot/api/hermes/cron/jobs/a/trigger", {
          method: "POST",
          headers: { origin: "not a URL" },
        }),
      ),
    ).toEqual(expect.objectContaining({ status: 403 }));
    expect(
      validateHermesBrowserRequest(
        new Request("https://bob.blder.bot/api/hermes/cron/jobs/a/trigger", {
          method: "POST",
        }),
      ),
    ).toEqual(expect.objectContaining({ status: 403 }));
    expect(
      validateHermesBrowserRequest(
        new Request("https://bob.blder.bot/hermes/ws", {
          headers: {
            origin: "https://evil.blder.bot",
            upgrade: "websocket",
          },
        }),
      ),
    ).toEqual(expect.objectContaining({ status: 403 }));
    expect(
      validateHermesBrowserRequest(
        {
          method: "CONNECT",
          url: "https://bob.blder.bot/hermes/api/status",
          headers: new Headers(),
        } as Request,
      ),
    ).toEqual(expect.objectContaining({ status: 405 }));
  });

  it("keeps the rotating management token server-side for native calls", () => {
    const token = extractHermesSessionToken(
      '<script>window.__HERMES_SESSION_TOKEN__="rotating-token";</script>',
    );
    expect(token).toBe("rotating-token");
    const incoming = new Request(
      "https://bob.blder.bot/api/hermes/cron/jobs?profile=all",
      { method: "POST" },
    );
    const bootstrap = createHermesBootstrapRequest(
      incoming,
      "https://claude.gmac.io",
      PROXY_TOKEN,
    );
    const proxied = createHermesNativeApiRequest(
      incoming,
      "https://claude.gmac.io",
      PROXY_TOKEN,
      token!,
    );
    expect(bootstrap.url).toBe("https://claude.gmac.io/hermes/");
    expect(bootstrap.headers.get("authorization")).toBe(
      `Bearer ${PROXY_TOKEN}`,
    );
    expect(proxied.url).toBe(
      "https://claude.gmac.io/hermes/api/cron/jobs?profile=all",
    );
    expect(proxied.headers.get("x-hermes-session-token")).toBe(
      "rotating-token",
    );
    expect(proxied.headers.get("authorization")).toBe(`Bearer ${PROXY_TOKEN}`);
  });

  it("sends HTML navigation to login without redirecting API calls", () => {
    expect(
      getHermesLoginRedirect(
        new Request("https://bob.blder.bot/hermes/sessions?profile=coder", {
          headers: { accept: "text/html" },
        }),
      ),
    ).toBe(
      "https://bob.blder.bot/login?callbackUrl=%2Fhermes%2Fsessions%3Fprofile%3Dcoder",
    );
    expect(
      getHermesLoginRedirect(
        new Request("https://bob.blder.bot/api/hermes/status", {
          headers: { accept: "application/json" },
        }),
      ),
    ).toBeNull();
  });

  it("rejects malformed Telegram tokens before proxying", async () => {
    await expect(
      validateHermesNativeApiMutation(
        new Request(
          "https://bob.blder.bot/api/hermes/messaging/platforms/telegram",
          {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              enabled: true,
              env: { TELEGRAM_BOT_TOKEN: "not-a-token" },
            }),
          },
        ),
      ),
    ).resolves.toEqual(
      expect.objectContaining({ field: "TELEGRAM_BOT_TOKEN" }),
    );
    await expect(
      validateHermesNativeApiMutation(
        new Request(
          "https://bob.blder.bot/api/hermes/messaging/platforms/telegram",
          {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: "null",
          },
        ),
      ),
    ).resolves.toEqual(expect.objectContaining({ field: "body" }));
  });

  it("aggregates a consistent overview in parallel", async () => {
    const payloads: Record<string, unknown> = {
      "/hermes/api/status": { gateway_running: true },
      "/hermes/api/messaging/platforms": { platforms: [{ id: "telegram" }] },
      "/hermes/api/cron/jobs?profile=all": [{ id: "morning" }],
      "/hermes/api/sessions?limit=12&offset=0&order=recent": {
        sessions: [{ id: "s1" }],
        total: 4,
      },
      "/hermes/api/providers/oauth": { providers: [{ id: "codex" }] },
    };
    const fetcher = vi.fn<typeof fetch>(async (request) => {
      const requestUrl =
        typeof request === "string"
          ? request
          : request instanceof URL
            ? request.href
            : request.url;
      const url = new URL(requestUrl);
      return Response.json(payloads[`${url.pathname}${url.search}`]);
    });
    await expect(
      fetchHermesOverview({
        origin: "https://claude.gmac.io",
        proxyToken: PROXY_TOKEN,
        sessionToken: "rotating-token",
        fetcher,
      }),
    ).resolves.toEqual(expect.objectContaining({ sessionTotal: 4 }));
    expect(fetcher).toHaveBeenCalledTimes(5);
  });

  it("strips origin cookies and rewrites absolute redirects to Bob", () => {
    const upstream = new Response("ok", {
      status: 302,
      headers: {
        location: "https://claude.gmac.io/hermes/login",
        "set-cookie": "hermes=secret",
        "access-control-allow-origin": "*",
      },
    });
    const safe = sanitizeHermesResponse(
      upstream,
      "https://bob.blder.bot",
      "https://claude.gmac.io",
    );
    expect(safe.headers.get("location")).toBe(
      "https://bob.blder.bot/hermes/login",
    );
    expect(safe.headers.has("set-cookie")).toBe(false);
    expect(safe.headers.has("access-control-allow-origin")).toBe(false);
  });
});

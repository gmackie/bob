import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createHermesNativeApiRequest,
  createHermesProxyRequest,
  extractHermesSessionToken,
  getHermesLoginRedirect,
  isHermesNativeApiPath,
  isHermesProxyPath,
} from "../hermes-proxy";

describe("Hermes dashboard proxy", () => {
  it("matches only the dedicated dashboard path", () => {
    assert.equal(isHermesProxyPath("/hermes"), true);
    assert.equal(isHermesProxyPath("/hermes/sessions?profile=coder"), true);
    assert.equal(isHermesProxyPath("/api/hermes"), false);
    assert.equal(isHermesProxyPath("/hermetic"), false);
    assert.equal(isHermesNativeApiPath("/api/hermes/status"), true);
    assert.equal(isHermesNativeApiPath("/api/hermes"), false);
    assert.equal(isHermesNativeApiPath("/hermes/api/status"), false);
  });

  it("keeps the Hermes session token server-side for native console API calls", () => {
    const token = extractHermesSessionToken(
      '<script>window.__HERMES_SESSION_TOKEN__="rotating-token";window.__HERMES_BASE_PATH__="/hermes";</script>',
    );
    assert.equal(token, "rotating-token");

    const proxied = createHermesNativeApiRequest(
      new Request("https://bob.blder.bot/api/hermes/cron/jobs?profile=all", {
        method: "POST",
        headers: { cookie: "better-auth.session_token=valid" },
      }),
      "https://claude.gmac.io",
      token!,
    );
    assert.equal(proxied.url, "https://claude.gmac.io/hermes/api/cron/jobs?profile=all");
    assert.equal(proxied.headers.get("x-hermes-session-token"), "rotating-token");
    assert.equal(proxied.headers.get("cookie"), "better-auth.session_token=valid");
  });

  it("preserves the prefixed path, query, cookie, and original public host", async () => {
    const incoming = new Request(
      "https://bob.blder.bot/hermes/api/config?profile=coder",
      {
        headers: {
          accept: "application/json",
          cookie: "better-auth.session_token=valid",
        },
      },
    );

    const proxied = createHermesProxyRequest(
      incoming,
      "https://claude.gmac.io",
    );

    assert.equal(
      proxied.url,
      "https://claude.gmac.io/hermes/api/config?profile=coder",
    );
    assert.equal(
      proxied.headers.get("cookie"),
      "better-auth.session_token=valid",
    );
    assert.equal(proxied.headers.get("x-forwarded-host"), "bob.blder.bot");
    assert.equal(proxied.headers.get("x-forwarded-proto"), "https");
  });

  it("sends browser navigations to login with a safe callback", () => {
    const redirect = getHermesLoginRedirect(
      new Request("https://bob.blder.bot/hermes/sessions?profile=coder", {
        headers: { accept: "text/html" },
      }),
    );

    assert.equal(
      redirect,
      "https://bob.blder.bot/login?callbackUrl=%2Fhermes%2Fsessions%3Fprofile%3Dcoder",
    );
  });

  it("does not redirect API or asset requests", () => {
    assert.equal(
      getHermesLoginRedirect(
        new Request("https://bob.blder.bot/hermes/api/config", {
          headers: { accept: "application/json" },
        }),
      ),
      null,
    );
  });
});

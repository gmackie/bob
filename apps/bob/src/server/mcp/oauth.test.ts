import { describe, expect, it } from "vitest";
import { z } from "zod/v4";
const clientResponse = z.object({ client_id: z.string() });
const tokenResponse = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
});
import { digest, makeOAuth, randomToken } from "./oauth";
import type {
  Credential,
  OAuthClient,
  OAuthGrant,
  OAuthIdentity,
  OAuthStore,
  OAuthTransaction,
} from "./types";

function memoryStore(): OAuthStore {
  const clients = new Map<string, OAuthClient>();
  const grants = new Map<string, OAuthGrant>();
  const credentials = new Map<string, Credential>();
  const tx: OAuthTransaction = {
    client: async (id) => clients.get(id),
    addClient: async (v) => {
      clients.set(v.id, v);
    },
    grant: async (id) => grants.get(id),
    addGrant: async (v) => {
      grants.set(v.id, v);
    },
    revoke: async (id) => {
      const g = grants.get(id);
      if (g) g.revokedAt = new Date();
    },
    credential: async (id) => credentials.get(id),
    addCredential: async (v) => {
      credentials.set(v.hash, v);
    },
    consume: async (id) => {
      const c = credentials.get(id);
      if (!c || c.usedAt) return undefined;
      c.usedAt = new Date();
      return c;
    },
  };
  return { ...tx, transaction: (work) => work(tx) };
}
const origin = "https://bob.example";
const redirect = "https://client.example/callback";
const workspaceId = "aaaabbbb-1111-4000-8000-000000000001";
function fixture() {
  const store = memoryStore();
  let currentTime = Date.now();
  let member = true;
  let write = true;
  const identity: OAuthIdentity = {
    session: async (r) =>
      r.headers.get("cookie") === "session=yes" ? { userId: "alice" } : null,
    workspaces: async () => [
      { id: workspaceId, name: "Workspace <one>", canWrite: write },
    ],
    access: async (u, w, needsWrite) =>
      member && u === "alice" && w === workspaceId && (!needsWrite || write),
  };
  const oauth = makeOAuth({ origin, store, identity, now: () => currentTime });
  const post = (
    path: string,
    params: Record<string, string>,
    headers: Record<string, string> = {},
  ) =>
    oauth.handle(
      new Request(`${origin}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          ...headers,
        },
        body: new URLSearchParams(params),
      }),
    );
  const register = async (
    metadata: unknown = {
      client_name: "Test <client>",
      redirect_uris: [redirect],
    },
  ) =>
    oauth.handle(
      new Request(`${origin}/oauth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(metadata),
      }),
    );
  async function start(scope = "bob:read bob:write") {
    const response = await register();
    const client = clientResponse.parse(await response.json());
    const verifier = randomToken();
    const params = new URLSearchParams({
      client_id: client.client_id,
      response_type: "code",
      redirect_uri: redirect,
      code_challenge: await digest(verifier),
      code_challenge_method: "S256",
      resource: oauth.resource,
      scope,
      state: "opaque-state",
    });
    const consentResponse = await oauth.handle(
      new Request(`${origin}/oauth/authorize?${params}`, {
        headers: { cookie: "session=yes" },
      }),
    );
    const html = await consentResponse.text();
    const consent = html.match(/name="consent" value="([^"]+)"/)?.[1];
    expect(consent).toBeTruthy();
    const authorize = () =>
      post(
        "/oauth/authorize",
        { consent: consent!, workspace_id: workspaceId, decision: "allow" },
        { cookie: "session=yes", Origin: origin },
      );
    const authorizationResponse = await authorize();
    expect(authorizationResponse.status).toBe(303);
    const location = new URL(authorizationResponse.headers.get("location")!);
    expect(location.searchParams.get("state")).toBe("opaque-state");
    const exchange = (overrides: Record<string, string> = {}) =>
      post("/oauth/token", {
        grant_type: "authorization_code",
        client_id: client.client_id,
        code: location.searchParams.get("code")!,
        redirect_uri: redirect,
        code_verifier: verifier,
        resource: oauth.resource,
        ...overrides,
      });
    return { client, verifier, exchange, authorize, consent, params, html };
  }
  const authenticate = (access: string) =>
    oauth.authenticate(
      new Request(`${origin}/mcp`, {
        headers: { authorization: `Bearer ${access}` },
      }),
    );
  return {
    oauth,
    store,
    post,
    register,
    start,
    authenticate,
    expire: () => {
      currentTime += 31 * 86400_000;
    },
    removeMember: () => {
      member = false;
    },
    makeViewer: () => {
      write = false;
    },
  };
}

describe("MCP OAuth", () => {
  it("publishes public discovery with a configured audience", async () => {
    const f = fixture();
    const r = await f.oauth.handle(
      new Request(`${origin}/.well-known/oauth-protected-resource/mcp`),
    );
    expect(await r.json()).toMatchObject({
      resource: `${origin}/mcp`,
      authorization_servers: [origin],
    });
    const metadata = await (
      await f.oauth.handle(
        new Request(`${origin}/.well-known/oauth-authorization-server`),
      )
    ).json();
    expect(metadata).toMatchObject({
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
    });
  });
  it("requires safe redirect metadata and public PKCE clients", async () => {
    const f = fixture();
    for (const callback of [
      "http://evil.example/cb",
      "https://client.example/cb#frag",
      "https://user:pass@client.example/cb",
      "javascript:alert(1)",
    ])
      expect((await f.register({ redirect_uris: [callback] })).status).toBe(
        400,
      );
    expect(
      (await f.register({ redirect_uris: ["http://127.0.0.1:1234/cb"] }))
        .status,
    ).toBe(201);
    expect(
      (
        await f.register({
          redirect_uris: [redirect],
          token_endpoint_auth_method: "client_secret_post",
        })
      ).status,
    ).toBe(400);
  });
  it("requires a real session and explicit single-use origin-bound consent", async () => {
    const f = fixture();
    const flow = await f.start();
    expect(flow.html).toContain("Test &lt;client&gt;");
    expect((await flow.authorize()).status).toBe(400);
    const denied = await f.post(
      "/oauth/authorize",
      { consent: flow.consent!, decision: "allow", workspace_id: workspaceId },
      { Origin: "https://evil.example", cookie: "session=yes" },
    );
    expect(denied.status).toBe(403);
    const unauth = await f.oauth.handle(
      new Request(`${origin}/oauth/authorize?${flow.params}`),
    );
    expect(await unauth.text()).toContain("Sign in with GitHub");
  });
  it("rejects wrong audience, client, redirect, and verifier without consuming the code", async () => {
    const f = fixture();
    const flow = await f.start();
    const invalidOverrides: Record<string, string>[] = [
      { resource: "https://evil.example/mcp" },
      { redirect_uri: `${redirect}/other` },
      { code_verifier: randomToken() },
      { client_id: "unknown" },
    ];
    for (const overrides of invalidOverrides)
      expect((await flow.exchange(overrides)).status).toBeGreaterThanOrEqual(
        400,
      );
    const exchanged = await flow.exchange();
    expect(exchanged.status).toBe(200);
    const tokens = tokenResponse.parse(await exchanged.json());
    expect(await f.authenticate(tokens.access_token)).toMatchObject({
      userId: "alice",
      workspaceId,
      scopes: ["bob:read", "bob:write"],
    });
    expect((await flow.exchange()).status).toBe(400);
    expect(await f.store.credential(tokens.access_token)).toBeUndefined();
    expect(
      await f.store.credential(await digest(tokens.access_token)),
    ).toMatchObject({ kind: "access" });
  });
  it("rotates refresh tokens and revokes the family on replay", async () => {
    const f = fixture();
    const flow = await f.start();
    const initial = tokenResponse.parse(await (await flow.exchange()).json());
    const refresh = () =>
      f.post("/oauth/token", {
        client_id: flow.client.client_id,
        grant_type: "refresh_token",
        refresh_token: initial.refresh_token,
        resource: f.oauth.resource,
      });
    const rotated = tokenResponse.parse(await (await refresh()).json());
    expect(rotated.refresh_token).not.toBe(initial.refresh_token);
    expect(await f.authenticate(rotated.access_token)).not.toBeNull();
    expect((await refresh()).status).toBe(400);
    expect(await f.authenticate(rotated.access_token)).toBeNull();
    expect(await f.authenticate(initial.access_token)).toBeNull();
  });
  it("supports downscoping, forbids scope expansion, and client-bound revocation", async () => {
    const f = fixture();
    const flow = await f.start();
    const initial = tokenResponse.parse(await (await flow.exchange()).json());
    const refresh = (token: string, scope: string) =>
      f.post("/oauth/token", {
        client_id: flow.client.client_id,
        grant_type: "refresh_token",
        refresh_token: token,
        resource: f.oauth.resource,
        scope,
      });
    const narrowed = tokenResponse.parse(
      await (await refresh(initial.refresh_token, "bob:read")).json(),
    );
    expect(await f.authenticate(narrowed.access_token)).toMatchObject({
      scopes: ["bob:read"],
    });
    expect(
      (await refresh(narrowed.refresh_token, "bob:read bob:write")).status,
    ).toBe(400);
    const other = clientResponse.parse(await (await f.register()).json());
    await f.post("/oauth/revoke", {
      client_id: other.client_id,
      token: narrowed.access_token,
    });
    expect(await f.authenticate(narrowed.access_token)).not.toBeNull();
    await f.post("/oauth/revoke", {
      client_id: flow.client.client_id,
      token: narrowed.access_token,
    });
    expect(await f.authenticate(narrowed.access_token)).toBeNull();
  });
  it("rechecks membership and expires grants", async () => {
    const f = fixture();
    const flow = await f.start();
    const tokens = tokenResponse.parse(await (await flow.exchange()).json());
    f.removeMember();
    expect(await f.authenticate(tokens.access_token)).toBeNull();
    const expired = fixture();
    const other = await expired.start();
    const t = tokenResponse.parse(await (await other.exchange()).json());
    expired.expire();
    expect(await expired.authenticate(t.access_token)).toBeNull();
  });
  it("denies ungranted workspaces and disallows PKCE downgrade or duplicate resource", async () => {
    const f = fixture();
    const flow = await f.start();
    for (const key of ["code_challenge_method", "redirect_uri", "resource"]) {
      const p = new URLSearchParams(flow.params);
      p.set(
        key,
        key === "code_challenge_method" ? "plain" : "https://evil.example",
      );
      expect(
        (
          await f.oauth.handle(
            new Request(`${origin}/oauth/authorize?${p}`, {
              headers: { cookie: "session=yes" },
            }),
          )
        ).status,
      ).toBe(400);
    }
    const p = new URLSearchParams(flow.params);
    p.append("resource", f.oauth.resource);
    expect(
      (await f.oauth.handle(new Request(`${origin}/oauth/authorize?${p}`)))
        .status,
    ).toBe(400);
    const pendingResponse = await f.oauth.handle(
      new Request(`${origin}/oauth/authorize?${flow.params}`, {
        headers: { cookie: "session=yes" },
      }),
    );
    const consent = (await pendingResponse.text()).match(
      /name="consent" value="([^"]+)"/,
    )![1];
    expect(
      (
        await f.post(
          "/oauth/authorize",
          { consent: consent!, decision: "allow", workspace_id: "other" },
          { cookie: "session=yes", Origin: origin },
        )
      ).status,
    ).toBe(403);
  });
});

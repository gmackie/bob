import type {
  OAuthGrant,
  OAuthIdentity,
  OAuthStore,
  OAuthTransaction,
} from "./types";

export const READ_SCOPE = "bob:read";
export const WRITE_SCOPE = "bob:write";
const ACCESS_SECONDS = 3600;
const GRANT_SECONDS = 30 * 86400;
const MAX_BODY = 32_768;
export class OAuthError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}
export const randomToken = () =>
  base64url(crypto.getRandomValues(new Uint8Array(32)));
function base64url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
export async function digest(value: string) {
  return base64url(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
  );
}
export function json(value: unknown, status = 200, headers?: HeadersInit) {
  const h = new Headers(headers);
  h.set("Content-Type", "application/json");
  h.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(value), { status, headers: h });
}
export async function readBody(request: Request): Promise<string> {
  if (Number(request.headers.get("content-length")) > MAX_BODY)
    throw new OAuthError("invalid_request", "Request too large", 413);
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY) {
      await reader.cancel();
      throw new OAuthError("invalid_request", "Request too large", 413);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(bytes);
}
function one(params: URLSearchParams, name: string, required = true) {
  const values = params.getAll(name);
  if (values.length > 1 || (required && !values[0]))
    throw new OAuthError("invalid_request", `Expected one ${name}`);
  return values[0] ?? "";
}
function scopes(value: string) {
  const result = [...new Set((value || READ_SCOPE).split(" ").filter(Boolean))];
  if (
    !result.includes(READ_SCOPE) ||
    result.some((s) => ![READ_SCOPE, WRITE_SCOPE].includes(s))
  ) {
    throw new OAuthError(
      "invalid_scope",
      "Request bob:read and optionally bob:write",
    );
  }
  return result;
}
function validRedirect(value: string) {
  try {
    const u = new URL(value);
    return (
      !u.hash &&
      !u.username &&
      !u.password &&
      (u.protocol === "https:" ||
        (u.protocol === "http:" &&
          ["127.0.0.1", "[::1]", "localhost"].includes(u.hostname)))
    );
  } catch {
    return false;
  }
}
const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
function page(content: string, script?: (nonce: string) => string) {
  const nonce = randomToken();
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect to Bob</title></head><body><main><h1>Connect to Bob</h1>${content}</main>${script?.(nonce) ?? ""}</body></html>`,
    {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        // A no-referrer document can produce Origin: null on a form POST.
        // Preserve same-origin consent submissions without leaking cross-origin.
        "Referrer-Policy": "same-origin",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`,
      },
    },
  );
}
interface Authorization {
  clientId: string;
  redirectUri: string;
  challenge: string;
  scopes: string[];
  resource: string;
  state: string;
}
export function makeOAuth(options: {
  origin: string;
  store: OAuthStore;
  identity: OAuthIdentity;
  now?: () => number;
}) {
  const { store, identity } = options;
  const origin = new URL(options.origin).origin;
  const resource = `${origin}/mcp`;
  const now = options.now ?? Date.now;
  const expiry = (seconds: number) => new Date(now() + seconds * 1000);
  const fresh = (date: Date) => date.getTime() > now();
  function audience(value: string) {
    if (value !== resource)
      throw new OAuthError(
        "invalid_target",
        "resource must be the Bob MCP endpoint",
      );
  }
  async function validateAuthorization(
    p: URLSearchParams,
  ): Promise<Authorization> {
    const clientId = one(p, "client_id");
    const client = await store.client(clientId);
    const redirectUri = one(p, "redirect_uri");
    if (!client || !client.redirectUris.includes(redirectUri))
      throw new OAuthError(
        "invalid_request",
        "Unknown client or unregistered redirect URI",
      );
    if (one(p, "response_type") !== "code")
      throw new OAuthError(
        "unsupported_response_type",
        "Only authorization code is supported",
      );
    const challenge = one(p, "code_challenge");
    if (
      one(p, "code_challenge_method") !== "S256" ||
      !/^[A-Za-z0-9_-]{43}$/.test(challenge)
    )
      throw new OAuthError("invalid_request", "S256 PKCE is required");
    const target = one(p, "resource");
    audience(target);
    return {
      clientId,
      redirectUri,
      challenge,
      scopes: scopes(one(p, "scope", false)),
      resource: target,
      state: one(p, "state", false),
    };
  }
  async function addCredential(
    tx: OAuthTransaction,
    token: string,
    kind: string,
    seconds: number,
    data: Record<string, unknown>,
    grantId: string | null = null,
  ) {
    await tx.addCredential({
      hash: await digest(token),
      kind,
      grantId,
      data,
      expiresAt: expiry(seconds),
      usedAt: null,
    });
  }
  async function issueTokens(
    tx: OAuthTransaction,
    grant: OAuthGrant,
    tokenScopes = grant.scopes,
  ) {
    const access = randomToken();
    const refresh = randomToken();
    const lifetime = Math.min(
      ACCESS_SECONDS,
      Math.floor((grant.expiresAt.getTime() - now()) / 1000),
    );
    await addCredential(
      tx,
      access,
      "access",
      lifetime,
      { scopes: tokenScopes },
      grant.id,
    );
    await addCredential(
      tx,
      refresh,
      "refresh",
      Math.floor((grant.expiresAt.getTime() - now()) / 1000),
      { scopes: tokenScopes },
      grant.id,
    );
    return {
      access_token: access,
      token_type: "Bearer",
      expires_in: lifetime,
      refresh_token: refresh,
      scope: tokenScopes.join(" "),
    };
  }
  async function form(request: Request) {
    if (
      !request.headers
        .get("content-type")
        ?.startsWith("application/x-www-form-urlencoded")
    )
      throw new OAuthError(
        "invalid_request",
        "Expected form-encoded request",
        415,
      );
    return new URLSearchParams(await readBody(request));
  }
  async function authorize(request: Request) {
    if (request.method === "GET") {
      const authorization = await validateAuthorization(
        new URL(request.url).searchParams,
      );
      const client = (await store.client(authorization.clientId))!;
      const session = await identity.session(request);
      if (!session) {
        const callback = `${origin}/oauth/authorize?${new URL(request.url).searchParams}`;
        // callback is server-constructed; JSON is escaped for the HTML script context.
        const literal = JSON.stringify(callback).replace(/</g, "\\u003c");
        return page(
          "<p>Sign in to choose a workspace and review this connection.</p><button id=signin>Sign in with GitHub</button><p id=error role=alert></p>",
          (nonce) =>
            `<script nonce="${nonce}">document.getElementById('signin').onclick=async()=>{try{const r=await fetch('/api/auth/sign-in/social',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({provider:'github',callbackURL:${literal}})});const d=await r.json();if(!r.ok||!d.url)throw Error('Sign-in failed');location.assign(d.url)}catch(e){document.getElementById('error').textContent='Sign-in failed. Please try again.'}};</script>`,
        );
      }
      const choices = await identity.workspaces(session.userId);
      const consent = randomToken();
      await addCredential(store, consent, "consent", 600, {
        ...authorization,
        userId: session.userId,
      });
      return page(
        `<p><strong>${escapeHtml(client.name)}</strong> requests permission to read projects and work items${authorization.scopes.includes(WRITE_SCOPE) ? ", update work items, and add comments" : ""}.</p><p>Callback: ${escapeHtml(new URL(authorization.redirectUri).origin)}</p><form method="post" action="/oauth/authorize"><input type="hidden" name="consent" value="${consent}"><label>Workspace <select name="workspace_id" required>${choices
          .filter(
            (w) => !authorization.scopes.includes(WRITE_SCOPE) || w.canWrite,
          )
          .map(
            (w) =>
              `<option value="${escapeHtml(w.id)}">${escapeHtml(w.name)}</option>`,
          )
          .join(
            "",
          )}</select></label><button name="decision" value="allow"${choices.length ? "" : " disabled"}>Allow connection</button><button name="decision" value="deny">Cancel</button></form>`,
      );
    }
    if (request.headers.get("origin") !== origin)
      throw new OAuthError("access_denied", "Invalid consent origin", 403);
    const session = await identity.session(request);
    if (!session)
      throw new OAuthError("access_denied", "Sign in before authorizing", 401);
    const body = await form(request);
    const hash = await digest(one(body, "consent"));
    const record = await store.credential(hash);
    if (
      !record ||
      record.kind !== "consent" ||
      record.usedAt ||
      !fresh(record.expiresAt) ||
      record.data.userId !== session.userId
    )
      throw new OAuthError(
        "invalid_request",
        "Consent expired; restart the connection",
      );
    const auth = record.data as unknown as Authorization;
    const destination = new URL(auth.redirectUri);
    const decision = one(body, "decision");
    if (!["allow", "deny"].includes(decision))
      throw new OAuthError("invalid_request", "Choose allow or deny");
    const workspaceId = one(body, "workspace_id", decision === "allow");
    if (
      decision === "allow" &&
      !(await identity.access(
        session.userId,
        workspaceId,
        auth.scopes.includes(WRITE_SCOPE),
      ))
    )
      throw new OAuthError("access_denied", "Workspace access denied", 403);
    await store.transaction(async (tx) => {
      if (!(await tx.consume(hash)))
        throw new OAuthError("invalid_request", "Consent already used");
      if (decision === "deny") {
        destination.searchParams.set("error", "access_denied");
        return;
      }
      const code = randomToken();
      await addCredential(tx, code, "code", 300, {
        ...auth,
        userId: session.userId,
        workspaceId,
      });
      destination.searchParams.set("code", code);
    });
    if (auth.state) destination.searchParams.set("state", auth.state);
    return new Response(null, {
      status: 303,
      headers: {
        Location: destination.toString(),
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
      },
    });
  }
  async function token(request: Request) {
    const body = await form(request);
    const clientId = one(body, "client_id");
    if (!(await store.client(clientId)))
      throw new OAuthError("invalid_client", "Unknown client", 401);
    audience(one(body, "resource"));
    const type = one(body, "grant_type");
    if (!["authorization_code", "refresh_token"].includes(type))
      throw new OAuthError("unsupported_grant_type", "Unsupported grant type");
    const hash = await digest(
      one(body, type === "authorization_code" ? "code" : "refresh_token"),
    );
    // Worker requests have a one-connection pool. Membership queries use the
    // request DB, so run them before reserving that connection for credentials.
    // The transaction below revalidates and atomically consumes the credential.
    const candidate = await store.credential(hash);
    if (
      candidate &&
      !candidate.usedAt &&
      fresh(candidate.expiresAt) &&
      candidate.kind === (type === "authorization_code" ? "code" : "refresh")
    ) {
      const principal =
        type === "authorization_code"
          ? (candidate.data as unknown as Authorization & {
              userId: string;
              workspaceId: string;
            })
          : candidate.grantId
            ? await store.grant(candidate.grantId)
            : undefined;
      const requested = one(body, "scope", false);
      const effectiveScopes =
        type === "refresh_token" && requested
          ? scopes(requested)
          : (candidate.data.scopes as string[]);
      if (
        principal &&
        !(await identity.access(
          principal.userId,
          principal.workspaceId,
          effectiveScopes.includes(WRITE_SCOPE),
        ))
      )
        throw new OAuthError(
          "invalid_grant",
          "Workspace access is no longer permitted",
        );
    }
    const result = await store.transaction(async (tx) => {
      const record = await tx.credential(hash);
      if (
        !record ||
        record.kind !== (type === "authorization_code" ? "code" : "refresh") ||
        !fresh(record.expiresAt)
      )
        return null;
      if (type === "authorization_code") {
        const auth = record.data as unknown as Authorization & {
          userId: string;
          workspaceId: string;
        };
        if (
          record.usedAt ||
          auth.clientId !== clientId ||
          auth.resource !== resource ||
          one(body, "redirect_uri") !== auth.redirectUri
        )
          return null;
        const verifier = one(body, "code_verifier");
        if (
          !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) ||
          (await digest(verifier)) !== auth.challenge
        )
          return null;
        if (!(await tx.consume(hash))) return null;
        const grant: OAuthGrant = {
          id: crypto.randomUUID(),
          clientId,
          userId: auth.userId,
          workspaceId: auth.workspaceId,
          resource,
          scopes: auth.scopes,
          expiresAt: expiry(GRANT_SECONDS),
          revokedAt: null,
        };
        await tx.addGrant(grant);
        return issueTokens(tx, grant);
      }
      const grant = record.grantId ? await tx.grant(record.grantId) : undefined;
      if (
        !grant ||
        grant.clientId !== clientId ||
        grant.resource !== resource ||
        grant.revokedAt ||
        !fresh(grant.expiresAt)
      )
        return null;
      if (record.usedAt) {
        await tx.revoke(grant.id);
        return null;
      }
      const grantedScopes = record.data.scopes as string[];
      const requestedScopes = one(body, "scope", false);
      const nextScopes = requestedScopes
        ? scopes(requestedScopes)
        : grantedScopes;
      if (nextScopes.some((s) => !grantedScopes.includes(s)))
        throw new OAuthError(
          "invalid_scope",
          "Cannot expand an existing grant",
        );
      if (!(await tx.consume(hash))) {
        await tx.revoke(grant.id);
        return null;
      }
      return issueTokens(tx, grant, nextScopes);
    });
    if (!result)
      throw new OAuthError(
        "invalid_grant",
        "Invalid, expired or already used credential",
      );
    return json(result);
  }
  async function register(request: Request) {
    if (!request.headers.get("content-type")?.startsWith("application/json"))
      throw new OAuthError("invalid_client_metadata", "Expected JSON", 415);
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(await readBody(request));
    } catch (e) {
      if (e instanceof OAuthError) throw e;
      throw new OAuthError("invalid_client_metadata", "Invalid JSON");
    }
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new OAuthError(
        "invalid_client_metadata",
        "Expected client metadata",
      );
    const redirects = body.redirect_uris;
    if (
      !Array.isArray(redirects) ||
      !redirects.length ||
      redirects.length > 10 ||
      redirects.some(
        (u) => typeof u !== "string" || u.length > 2048 || !validRedirect(u),
      )
    )
      throw new OAuthError(
        "invalid_redirect_uri",
        "Use exact HTTPS callbacks or loopback HTTP callbacks",
      );
    if (
      body.token_endpoint_auth_method &&
      body.token_endpoint_auth_method !== "none"
    )
      throw new OAuthError(
        "invalid_client_metadata",
        "Only public PKCE clients are supported",
      );
    if (
      body.grant_types &&
      (!Array.isArray(body.grant_types) ||
        body.grant_types.some(
          (t) => !["authorization_code", "refresh_token"].includes(t),
        ))
    )
      throw new OAuthError(
        "invalid_client_metadata",
        "Unsupported grant types",
      );
    if (
      body.response_types &&
      (!Array.isArray(body.response_types) ||
        body.response_types.some((t) => t !== "code"))
    )
      throw new OAuthError(
        "invalid_client_metadata",
        "Unsupported response types",
      );
    const name =
      typeof body.client_name === "string"
        ? body.client_name.trim().slice(0, 128)
        : "MCP client";
    const client = {
      id: crypto.randomUUID(),
      name: name || "MCP client",
      redirectUris: redirects as string[],
    };
    await store.addClient(client);
    return json(
      {
        client_id: client.id,
        client_name: client.name,
        redirect_uris: client.redirectUris,
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        scope: `${READ_SCOPE} ${WRITE_SCOPE}`,
      },
      201,
    );
  }
  async function revoke(request: Request) {
    const body = await form(request);
    const clientId = one(body, "client_id");
    if (!(await store.client(clientId)))
      throw new OAuthError("invalid_client", "Unknown client", 401);
    const credential = await store.credential(await digest(one(body, "token")));
    const grant = credential?.grantId
      ? await store.grant(credential.grantId)
      : undefined;
    if (grant?.clientId === clientId) await store.revoke(grant.id);
    return new Response(null, {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  }
  async function authenticate(request: Request): Promise<OAuthGrant | null> {
    const bearer = request.headers
      .get("authorization")
      ?.match(/^Bearer ([A-Za-z0-9_-]{43})$/i)?.[1];
    if (!bearer) return null;
    const record = await store.credential(await digest(bearer));
    if (
      !record ||
      record.kind !== "access" ||
      !record.grantId ||
      !fresh(record.expiresAt)
    )
      return null;
    const grant = await store.grant(record.grantId);
    if (
      !grant ||
      grant.revokedAt ||
      !fresh(grant.expiresAt) ||
      grant.resource !== resource ||
      !(await identity.access(grant.userId, grant.workspaceId, false))
    )
      return null;
    return { ...grant, scopes: record.data.scopes as string[] };
  }
  return {
    resource,
    authenticate,
    async handle(request: Request): Promise<Response> {
      try {
        const path = new URL(request.url).pathname;
        if (
          request.method === "GET" &&
          [
            "/.well-known/oauth-protected-resource",
            "/.well-known/oauth-protected-resource/mcp",
          ].includes(path)
        )
          return json({
            resource,
            authorization_servers: [origin],
            scopes_supported: [READ_SCOPE, WRITE_SCOPE],
            bearer_methods_supported: ["header"],
            resource_name: "Bob",
          });
        if (
          request.method === "GET" &&
          path === "/.well-known/oauth-authorization-server"
        )
          return json({
            issuer: origin,
            authorization_endpoint: `${origin}/oauth/authorize`,
            token_endpoint: `${origin}/oauth/token`,
            registration_endpoint: `${origin}/oauth/register`,
            revocation_endpoint: `${origin}/oauth/revoke`,
            response_types_supported: ["code"],
            grant_types_supported: ["authorization_code", "refresh_token"],
            code_challenge_methods_supported: ["S256"],
            token_endpoint_auth_methods_supported: ["none"],
            revocation_endpoint_auth_methods_supported: ["none"],
            scopes_supported: [READ_SCOPE, WRITE_SCOPE],
          });
        if (
          path === "/oauth/authorize" &&
          ["GET", "POST"].includes(request.method)
        )
          return await authorize(request);
        if (request.method === "POST" && path === "/oauth/register")
          return await register(request);
        if (request.method === "POST" && path === "/oauth/token")
          return await token(request);
        if (request.method === "POST" && path === "/oauth/revoke")
          return await revoke(request);
        return json({ error: "invalid_request" }, 405);
      } catch (e) {
        if (e instanceof OAuthError)
          return json(
            { error: e.code, error_description: e.message },
            e.status,
          );
        console.error(
          "[mcp] OAuth request failed",
          e instanceof Error ? e.name : "UnknownError",
        );
        return json({ error: "server_error" }, 500);
      }
    },
  };
}

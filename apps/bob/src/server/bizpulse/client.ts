import { createHash, randomBytes } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { z } from "zod/v4";

const requested = [
  "credentials:read",
  "credentials:propose",
  "credentials:execute",
];
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const tokenPair = z.object({
  token_type: z.literal("Bearer"),
  access_token: z.string().regex(tokenPattern),
  refresh_token: z.string().regex(tokenPattern),
  expires_in: z.number().int().positive().max(3600),
  scope: z.string().max(256),
});
export const savedToken = tokenPair.pick({
  access_token: true,
  refresh_token: true,
  scope: true,
});
export type SavedToken = z.infer<typeof savedToken>;

export function bizpulseConfig() {
  const configured = process.env.BOB_BIZPULSE_MCP_ORIGIN;
  const frontend = process.env.FRONTEND_URL ?? process.env.NEXT_PUBLIC_SITE_URL;
  if (!configured || !frontend) return null;
  try {
    const origin = new URL(configured);
    const bob = new URL(frontend);
    if (
      origin.origin !== configured ||
      origin.protocol !== "https:" ||
      bob.protocol !== "https:" ||
      bob.username ||
      bob.password
    )
      return null;
    return {
      origin: origin.origin,
      bobOrigin: bob.origin,
      resource: origin.origin + "/mcp",
      callback: bob.origin + "/api/bizpulse/callback",
    };
  } catch {
    return null;
  }
}
export type BizPulseConfig = NonNullable<ReturnType<typeof bizpulseConfig>>;

async function fetchPinned(url: string, options: RequestInit = {}) {
  return fetch(url, {
    ...options,
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
}

export async function discover(config: BizPulseConfig) {
  const [resource, issuer] = await Promise.all([
    fetchPinned(config.origin + "/.well-known/oauth-protected-resource/mcp"),
    fetchPinned(config.origin + "/.well-known/oauth-authorization-server"),
  ]);
  if (!resource.ok || !issuer.ok)
    throw new Error("BizPulse OAuth discovery is unavailable");
  z.object({
    resource: z.literal(config.resource),
    authorization_servers: z
      .array(z.string())
      .refine((v) => v.length === 1 && v.includes(config.origin)),
  }).parse(await resource.json());
  return z
    .object({
      issuer: z.literal(config.origin),
      authorization_endpoint: z.literal(config.origin + "/oauth/authorize"),
      token_endpoint: z.literal(config.origin + "/oauth/token"),
    })
    .parse(await issuer.json());
}

export const stateDigest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export function createAuthorization(
  config: BizPulseConfig,
  authorizationEndpoint: string,
) {
  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(32).toString("base64url");
  const url = new URL(authorizationEndpoint);
  url.search = new URLSearchParams({
    client_id: "bob",
    response_type: "code",
    state,
    redirect_uri: config.callback,
    resource: config.resource,
    scope: requested.join(" "),
    code_challenge_method: "S256",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
  }).toString();
  return { state, verifier, url };
}

export class InvalidBizPulseGrant extends Error {}

export async function exchange(
  config: BizPulseConfig,
  grant:
    | { kind: "code"; code: string; verifier: string }
    | { kind: "refresh"; refreshToken: string },
) {
  const body = new URLSearchParams({
    client_id: "bob",
    resource: config.resource,
  });
  if (grant.kind === "code") {
    body.set("grant_type", "authorization_code");
    body.set("code", grant.code);
    body.set("code_verifier", grant.verifier);
    body.set("redirect_uri", config.callback);
  } else {
    body.set("grant_type", "refresh_token");
    body.set("refresh_token", grant.refreshToken);
  }
  const result = await fetchPinned(config.origin + "/oauth/token", {
    method: "POST",
    body,
  });
  if (!result.ok) {
    const error = z
      .object({ error: z.string() })
      .safeParse(await result.json().catch(() => null));
    if (error.success && error.data.error === "invalid_grant")
      throw new InvalidBizPulseGrant();
    throw new Error("BizPulse token exchange failed");
  }
  const pair = tokenPair.parse(await result.json());
  const granted = pair.scope.split(" ");
  if (
    !granted.includes("credentials:read") ||
    granted.some((scope) => !requested.includes(scope))
  )
    throw new Error("Invalid BizPulse scopes");
  return pair;
}

export async function revoke(config: BizPulseConfig, token: string) {
  const result = await fetchPinned(config.origin + "/oauth/revoke", {
    method: "POST",
    body: new URLSearchParams({ client_id: "bob", token }),
  });
  if (!result.ok) throw new Error("BizPulse disconnect failed");
}

export async function useClient<T>(
  config: BizPulseConfig,
  accessToken: string,
  run: (client: Client) => Promise<T>,
) {
  const transport = new StreamableHTTPClientTransport(
    new URL(config.resource),
    {
      requestInit: { headers: { Authorization: `Bearer ${accessToken}` } },
      fetch: async (url, init) => {
        if (String(url) !== config.resource)
          throw new Error("Unexpected MCP endpoint");
        return fetch(url, {
          ...init,
          redirect: "error",
          signal: init?.signal ?? AbortSignal.timeout(10_000),
        });
      },
    },
  );
  const client = new Client({ name: "bob", version: "1.0.0" });
  try {
    await client.connect(transport);
    return await run(client);
  } finally {
    await client.close();
  }
}

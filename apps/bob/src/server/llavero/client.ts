import { createHash, randomBytes } from "node:crypto";
import { z } from "zod/v4";

import { useClient as withMcpClient } from "../bizpulse/client";

const scopes = ["llavero:read", "llavero:propose", "offline_access"];
const expectedTools = ["rotation_propose", "rotation_run_request", "rotation_status"];

export function llaveroConfig() {
  const origin = process.env.BOB_LLAVERO_MCP_ORIGIN ?? "https://keys.gmac.io";
  const frontend = process.env.FRONTEND_URL ?? process.env.NEXT_PUBLIC_SITE_URL;
  if (!frontend || !["https://keys.gmac.io", "https://keys-stg.gmac.io"].includes(origin))
    return null;
  try {
    const bob = new URL(frontend);
    if (bob.protocol !== "https:" || bob.username || bob.password) return null;
    return {
      origin,
      bobOrigin: bob.origin,
      resource: origin + "/mcp",
      issuer: origin + "/api/auth",
      callback: bob.origin + "/api/llavero/callback",
    };
  } catch {
    return null;
  }
}

export type LlaveroConfig = NonNullable<ReturnType<typeof llaveroConfig>>;

async function request(url: string, init?: RequestInit) {
  return fetch(url, {
    ...init,
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
}

async function readJson<T>(schema: z.ZodType<T>, url: string, init?: RequestInit) {
  const response = await request(url, init);
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error("Llavero OAuth request failed");
  }
  return schema.parse(await response.json());
}

export async function registerLlavero(config: LlaveroConfig) {
  const [, metadata] = await Promise.all([
    readJson(z.object({
      resource: z.literal(config.resource),
      authorization_servers: z.tuple([z.literal(config.issuer)]),
    }), config.origin + "/.well-known/oauth-protected-resource/mcp"),
    readJson(z.object({
      issuer: z.literal(config.issuer),
      authorization_endpoint: z.literal(config.issuer + "/oauth2/authorize"),
      token_endpoint: z.literal(config.issuer + "/oauth2/token"),
      registration_endpoint: z.literal(config.issuer + "/oauth2/register"),
      revocation_endpoint: z.literal(config.issuer + "/oauth2/revoke"),
      code_challenge_methods_supported: z.array(z.string()).refine((v) => v.includes("S256")),
    }), config.origin + "/.well-known/oauth-authorization-server/api/auth"),
  ]);
  const client = await readJson(
    z.object({ client_id: z.string().min(1).max(200) }),
    metadata.registration_endpoint,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_name: "Bob credential rotations",
        redirect_uris: [config.callback],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        scope: scopes.join(" "),
      }),
    },
  );
  const verifier = randomBytes(32).toString("base64url");
  const state = randomBytes(32).toString("base64url");
  const url = new URL(metadata.authorization_endpoint);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: client.client_id,
    redirect_uri: config.callback,
    resource: config.resource,
    scope: scopes.join(" "),
    state,
    code_challenge_method: "S256",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
  }).toString();
  return { clientId: client.client_id, state, verifier, url };
}

export const savedLlaveroTokens = z.object({
  access_token: z.string().regex(/^gmo_[A-Za-z0-9_-]{1,512}$/),
  refresh_token: z.string().regex(/^gmr_[A-Za-z0-9_-]{1,512}$/),
});
const tokenResponse = savedLlaveroTokens.extend({
  token_type: z.string().refine((v) => v.toLowerCase() === "bearer"),
  expires_in: z.number().int().positive().max(3600),
  scope: z.string().max(200),
});

export async function exchangeLlavero(
  config: LlaveroConfig,
  clientId: string,
  grant: { code: string; verifier: string } | { refreshToken: string },
) {
  const pair = await readJson(tokenResponse, config.issuer + "/oauth2/token", {
    method: "POST",
    body: new URLSearchParams({
      client_id: clientId,
      resource: config.resource,
      ...("code" in grant
        ? {
            grant_type: "authorization_code",
            code: grant.code,
            code_verifier: grant.verifier,
            redirect_uri: config.callback,
          }
        : { grant_type: "refresh_token", refresh_token: grant.refreshToken }),
    }),
  });
  const granted = new Set(pair.scope.split(/\s+/));
  if (
    !granted.has("llavero:read") ||
    !granted.has("llavero:propose") ||
    [...granted].some((scope) => !scopes.includes(scope))
  ) {
    await revokeLlavero(config, clientId, pair.refresh_token).catch(() => false);
    throw new Error("Llavero granted unexpected rotation permissions");
  }
  return pair;
}

export async function revokeLlavero(
  config: LlaveroConfig,
  clientId: string,
  refreshToken: string,
) {
  const response = await request(config.issuer + "/oauth2/revoke", {
    method: "POST",
    body: new URLSearchParams({
      client_id: clientId,
      token: refreshToken,
      token_type_hint: "refresh_token",
    }),
  });
  await response.body?.cancel();
  return response.ok;
}

export async function checkLlaveroTools(config: LlaveroConfig, accessToken: string) {
  return withMcpClient(config, accessToken, async (client) => {
    const { tools } = await client.listTools(undefined, { timeout: 10_000 });
    return expectedTools.every((name) => tools.some((tool) => tool.name === name));
  });
}

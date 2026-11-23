/** Artifacts token broker for the personal vault. Issues short-lived Git tokens
 * for exactly one repository (REPO_NAME, fixed at deploy time). The write secret
 * belongs to the Node vault host; the read secret to read-only mirrors. Never
 * returns another repository's tokens and exposes no other management operation. */
const TTL = { write: 900, read: 3600 };

function equal(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export default {
  async fetch(request, env) {
    const reply = (status, body) =>
      Response.json(body, { status, headers: { "cache-control": "no-store" } });
    const presented = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
    const scope = env.WRITE_SECRET && equal(presented, env.WRITE_SECRET) ? "write"
      : env.READ_SECRET && equal(presented, env.READ_SECRET) ? "read" : null;
    if (!scope) return reply(401, { code: "Unauthenticated" });
    const url = new URL(request.url);
    if (url.search || !/^[a-z0-9][a-z0-9-]*$/.test(env.REPO_NAME ?? "")) {
      return reply(400, { code: "InvalidRequest" });
    }
    try {
      if (request.method === "GET" && url.pathname === "/repo") {
        using repo = await env.ARTIFACTS.get(env.REPO_NAME);
        const info = await repo.info();
        return reply(200, { id: info.id, name: info.name, remote: info.remote });
      }
      if (request.method === "POST" && url.pathname === "/token") {
        using repo = await env.ARTIFACTS.get(env.REPO_NAME);
        const token = await repo.createToken(scope, TTL[scope]);
        return reply(200, { plaintext: token.plaintext, expiresAt: token.expiresAt, scope, ttl: TTL[scope] });
      }
      return reply(405, { code: "MethodNotAllowed" });
    } catch (error) {
      if (error?.code === 10200 || error?.code === "NOT_FOUND") return reply(404, { code: "NotFound" });
      return reply(502, { code: "ProviderFailure" });
    }
  },
};

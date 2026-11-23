import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { edgeRouter, createTRPCContext } from "@gmacko/ooda/api";
import { auth } from "~/auth/server";
// Per-request Hyperdrive client (lazy Proxy). Inject it so context db queries
// (e.g. programmatic apiKey validation in authedProcedure) run against the
// working edge connection rather than the import-time-bound module client.
import { db as edgeDb } from "~/lib/db-client-lazy";
import {
  VAULT_ASSERTION_HEADER,
  isVaultOnlyTrpcPath,
  signVaultAssertion,
} from "@gmacko/ooda/vault/origin-assertion";

/**
 * The edge has no filesystem vault. Vault-only tRPC batches are forwarded to
 * the Node vault host's origin (Bob #235): a browser/mobile session becomes a
 * signed identity assertion (cookies are never forwarded); API-key callers keep
 * their Authorization header and are validated by the origin itself.
 */
async function forwardVault(req: Request): Promise<Response | null> {
  const url = new URL(req.url);
  const origin = process.env.VAULT_ORIGIN_URL;
  const secret = process.env.VAULT_ORIGIN_SECRET;
  if (!origin || !secret || !isVaultOnlyTrpcPath(url.pathname)) return null;
  const body = req.method === "GET" || req.method === "HEAD" ? "" : await req.text();
  const headers = new Headers({ "content-type": req.headers.get("content-type") ?? "application/json" });
  const source = req.headers.get("x-trpc-source");
  if (source) headers.set("x-trpc-source", source);
  const session = req.headers.get("cookie")?.trim()
    ? await auth.api.getSession({ headers: req.headers }).catch(() => null)
    : null;
  if (session?.user?.id) {
    headers.set(VAULT_ASSERTION_HEADER, await signVaultAssertion(secret, session.user.id, {
      method: req.method, pathAndQuery: url.pathname + url.search, body,
    }));
  } else {
    for (const name of ["authorization", "x-api-key"]) {
      const value = req.headers.get(name);
      if (value) headers.set(name, value);
    }
  }
  const upstream = await fetch(origin.replace(/\/$/, "") + url.pathname + url.search, {
    method: req.method, headers, redirect: "manual",
    ...(body ? { body } : {}),
  });
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { "content-type": upstream.headers.get("content-type") ?? "application/json", "cache-control": "no-store" },
  });
}

const handler = async (req: Request) => {
  const forwarded = await forwardVault(req);
  if (forwarded) return forwarded;
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    router: edgeRouter,
    req,
    createContext: () =>
      createTRPCContext({
        headers: req.headers,
        auth,
        db: edgeDb as unknown as Parameters<typeof createTRPCContext>[0]["db"],
      }),
    onError({ error, path }) {
      // postgres.js wraps the real failure as `error.cause` (a PostgresError
      // carrying .code/.detail/.routine) or nests it under the tRPC cause
      // chain. Surface all of it — the bare `error.message` is just
      // "Failed query: ..." and hides why.
      const chain: unknown[] = [];
      let cur: unknown = error;
      for (let i = 0; i < 5 && cur; i++) {
        const e = cur as {
          message?: string;
          code?: string;
          detail?: string;
          routine?: string;
          severity?: string;
          cause?: unknown;
        };
        chain.push({
          message: e.message,
          code: e.code,
          detail: e.detail,
          routine: e.routine,
          severity: e.severity,
        });
        cur = e.cause;
      }
      console.error(`>>> tRPC Error on '${path}'`, JSON.stringify(chain));
    },
  });
};

export { handler as GET, handler as POST };

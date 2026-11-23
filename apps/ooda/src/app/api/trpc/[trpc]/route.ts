import type { NextRequest } from "next/server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter, createTRPCContext } from "@gmacko/ooda/api";
import { auth } from "~/auth/server";
import { getConfiguredNodeVault } from "@gmacko/ooda/vault/node-host";
import {
  VAULT_ASSERTION_HEADER,
  isVaultOnlyTrpcPath,
  verifyVaultAssertion,
} from "@gmacko/ooda/vault/origin-assertion";

export const runtime = "nodejs";

/** Actor asserted by the edge for vault-only requests (Bob #235); else undefined. */
async function vaultActor(req: NextRequest): Promise<string | undefined> {
  const header = req.headers.get(VAULT_ASSERTION_HEADER);
  if (!header || !isVaultOnlyTrpcPath(req.nextUrl.pathname)) return undefined;
  const actor = await verifyVaultAssertion(process.env.VAULT_ORIGIN_SECRET, header, {
    method: req.method,
    pathAndQuery: req.nextUrl.pathname + req.nextUrl.search,
    body: req.method === "GET" ? "" : await req.clone().text(),
  });
  return actor ?? undefined;
}

const handler = async (req: NextRequest) => {
  const asserted = await vaultActor(req);
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    router: appRouter,
    req,
    createContext: async () => createTRPCContext({ headers: req.headers, auth,
      vaultHost: (await getConfiguredNodeVault())?.routeHost,
      ...(asserted ? { vaultActor: asserted } : {}) }),
    onError({ error, path }) {
      if (process.env.NODE_ENV === "development") {
        console.error(`>>> tRPC Error on '${path}'`, error);
      } else {
        console.error(`>>> tRPC Error on '${path}'`, error.message);
      }
    },
  });
};

export { handler as GET, handler as POST };

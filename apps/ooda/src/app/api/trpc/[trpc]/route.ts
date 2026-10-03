import type { NextRequest } from "next/server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter, createTRPCContext } from "@gmacko/ooda/api";
import { auth } from "~/auth/server";
import { getConfiguredNodeVault } from "@gmacko/ooda/vault/node-host";

export const runtime = "nodejs";

const handler = async (req: NextRequest) => {
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    router: appRouter,
    req,
    createContext: async () => createTRPCContext({ headers: req.headers, auth,
      vaultHost: (await getConfiguredNodeVault())?.routeHost }),
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

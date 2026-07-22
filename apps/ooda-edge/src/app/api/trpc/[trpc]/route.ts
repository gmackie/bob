import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { edgeRouter, createTRPCContext } from "@gmacko/ooda/api";
import { auth } from "~/auth/server";
// Per-request Hyperdrive client (lazy Proxy). Inject it so context db queries
// (e.g. programmatic apiKey validation in authedProcedure) run against the
// working edge connection rather than the import-time-bound module client.
import { db as edgeDb } from "~/lib/db-client-lazy";

const handler = async (req: Request) => {
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
      console.error(`>>> tRPC Error on '${path}'`, error.message);
    },
  });
};

export { handler as GET, handler as POST };

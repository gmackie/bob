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

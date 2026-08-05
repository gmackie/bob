import type { NextRequest } from "next/server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter, createTRPCContext } from "@gmacko/ooda/api";
import { auth } from "~/auth/server";

const handler = async (req: NextRequest) => {
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    router: appRouter,
    req,
    createContext: () => createTRPCContext({ headers: req.headers, auth }),
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

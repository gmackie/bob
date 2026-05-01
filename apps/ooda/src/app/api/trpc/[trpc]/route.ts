import type { NextRequest } from "next/server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter, createTRPCContext } from "@gmacko/ooda/api";
import { initAuth } from "@gmacko/core/auth";
import { db } from "@gmacko/ooda/db/client";

const auth = initAuth({
  db,
  pluralizeTables: true,
  baseUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3001",
  productionUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3001",
  secret: process.env.AUTH_SECRET ?? "",
  githubClientId: process.env.AUTH_GITHUB_ID ?? "",
  githubClientSecret: process.env.AUTH_GITHUB_SECRET ?? "",
});

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

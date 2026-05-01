import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { edgeRouter, createTRPCContext } from "@gmacko/ooda/api";
import { auth } from "~/auth/server";

const handler = async (req: Request) => {
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    router: edgeRouter,
    req,
    createContext: () => createTRPCContext({ headers: req.headers, auth }),
    onError({ error, path }) {
      console.error(`>>> tRPC Error on '${path}'`, error.message);
    },
  });
};

export { handler as GET, handler as POST };

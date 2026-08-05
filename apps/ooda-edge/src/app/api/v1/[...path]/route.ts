import { createTRPCContext } from "@gmacko/ooda/api";
import { handleOodaV1EdgeHttpRequest } from "@gmacko/ooda/api/openapi";
import { auth } from "~/auth/server";
import { db } from "~/lib/db-client-lazy";

const handler = (request: Request) =>
  handleOodaV1EdgeHttpRequest({
    request,
    createContext: () =>
      createTRPCContext({
        headers: request.headers,
        auth,
        db: db as unknown as Parameters<typeof createTRPCContext>[0]["db"],
      }),
  });

export {
  handler as DELETE,
  handler as GET,
  handler as HEAD,
  handler as OPTIONS,
  handler as PATCH,
  handler as POST,
  handler as PUT,
};

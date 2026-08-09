import { handleOodaV1HttpRequest } from "@gmacko/ooda/api/openapi";
import { createTRPCContext } from "@gmacko/ooda/api";
import { auth } from "~/auth/server";

export const dynamic = "force-dynamic";

const handler = (request: Request) =>
  handleOodaV1HttpRequest({
    request,
    createContext: () => createTRPCContext({ headers: request.headers, auth }),
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

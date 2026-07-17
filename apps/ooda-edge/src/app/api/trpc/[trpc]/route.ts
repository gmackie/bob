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
      const cause = error.cause as
        | {
            name?: string;
            message?: string;
            code?: string;
            column_name?: string;
            table_name?: string;
            constraint_name?: string;
          }
        | undefined;
      console.error(`>>> tRPC Error on '${path}'`, error.message, {
        code: error.code,
        causeName: cause?.name,
        causeMessage: cause?.message,
        causeCode: cause?.code,
        columnName: cause?.column_name,
        tableName: cause?.table_name,
        constraintName: cause?.constraint_name,
      });
    },
  });
};

export { handler as GET, handler as POST };

import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { cookies } from "next/headers";
import { appRouter, createContext } from "@linear-clone/api";

const handler = async (req: Request) => {
  const cookieStore = await cookies();

  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    createContext: async () => {
      return createContext({
        req: {
          headers: {
            authorization: req.headers.get("authorization") ?? undefined,
            "x-api-key": req.headers.get("x-api-key") ?? undefined,
            "x-beta-auth-bypass": req.headers.get("x-beta-auth-bypass") ?? undefined,
            "x-beta-user-id": req.headers.get("x-beta-user-id") ?? undefined,
            cookie: req.headers.get("cookie") ?? undefined,
          },
          cookies: {
            get: (name: string) => {
              const value = cookieStore.get(name)?.value;
              return value ? { value } : undefined;
            },
          },
        },
      });
    },
  });
};

export { handler as GET, handler as POST };

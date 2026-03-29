import { appRouter, createTRPCContext } from "@bob/api";

import { auth } from "~/auth/server";

export async function createPublicApiCaller(request: Request) {
  const ctx = await createTRPCContext({
    headers: request.headers,
    auth,
  });
  return appRouter.createCaller(ctx);
}

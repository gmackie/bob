import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { appRouter, createTRPCContext } from "@bob/api";

import { authBundle, getSession } from "~/auth/server";

export async function createPlanningCaller() {
  const session = await getSession();

  if (!session) {
    redirect("/login");
  }

  const requestHeaders = new Headers(await headers());
  requestHeaders.set("x-trpc-source", "rsc");

  const ctx = await createTRPCContext({
    headers: requestHeaders,
    authBundle,
  });

  return appRouter.createCaller(ctx);
}

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createBobQueryClient } from "@gmacko/bob-client/query";
import { getSession } from "~/auth/server";
import { rpcHandler } from "~/server/rpc";

/** Run server reads through the same authenticated Effect contracts as clients. */
export async function createPlanningClient() {
  if (!(await getSession())) redirect("/login");
  const incoming = await headers();
  const authentication: Record<string, string> = {};
  for (const name of ["cookie", "authorization", "x-tenant-id"]) {
    const value = incoming.get(name);
    if (value) authentication[name] = value;
  }
  return createBobQueryClient({
    baseURL: "http://bob.internal/api/rpc",
    headers: authentication,
    fetch: (input, init) => rpcHandler(new Request(input, init)),
  });
}

import { getIntegrationStatuses } from "@bob/config/integrations";

import { auth } from "~/auth/server";

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  const headers = { "Cache-Control": "private, no-store" };
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401, headers });
  }
  return Response.json(getIntegrationStatuses(), { headers });
}

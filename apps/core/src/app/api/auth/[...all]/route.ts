import "server-only";

import { getServerLayers } from "@/server/layers";

// Resolve the shared migrated database and auth instance before handling requests.
async function withMigrations(req: Request): Promise<Response> {
  const { authInstance } = await getServerLayers();
  return authInstance.handler(req);
}

export const GET = withMigrations;
export const POST = withMigrations;

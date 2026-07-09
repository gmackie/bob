import { NextResponse } from "next/server";
import { createPublicApiCaller, errorResponse } from "~/lib/rest/api-helpers";

/**
 * Registers a discovered repository as a ForgeGraph-linked project.
 *
 * Replaces the removed gateway proxy. Callable from the onboarding UI (browser
 * cookie session) or from the ForgeGraph daemon/CLI (bearer API key). Both auth
 * paths are resolved by `createPublicApiCaller`.
 *
 * Body: `{ workspaceId: uuid, path: string, key?: string }`
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      workspaceId?: unknown;
      path?: unknown;
      key?: unknown;
    };

    if (typeof body.workspaceId !== "string" || typeof body.path !== "string") {
      return NextResponse.json(
        { error: "workspaceId and path are required" },
        { status: 400 },
      );
    }

    const caller = await createPublicApiCaller(request);
    const result = await caller.project.registerForge({
      workspaceId: body.workspaceId,
      path: body.path,
      key: typeof body.key === "string" ? body.key : undefined,
    });
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}

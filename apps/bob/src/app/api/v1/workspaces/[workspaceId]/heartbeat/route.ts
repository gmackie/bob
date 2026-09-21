import { NextResponse } from "next/server";
import {
  createPublicApiCaller,
  errorResponse,
  withApiRateLimit,
} from "~/lib/rest/api-helpers";

function parseRuntime(value: unknown):
  | {
      kind: "bob" | "t3";
      version?: string;
      connectionMode?: "local" | "remote" | "tunnel";
    }
  | undefined {
  if (typeof value !== "object" || value === null || !("kind" in value)) {
    return undefined;
  }
  const runtime = value as Record<string, unknown>;
  const kind = runtime.kind;
  if (kind !== "bob" && kind !== "t3") return undefined;
  const connectionMode = runtime.connectionMode;
  return {
    kind,
    ...(typeof runtime.version === "string"
      ? { version: runtime.version }
      : {}),
    ...(connectionMode === "local" ||
    connectionMode === "remote" ||
    connectionMode === "tunnel"
      ? { connectionMode }
      : {}),
  };
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  return withApiRateLimit(request, async () => {
    try {
      const { workspaceId } = await params;
      const body = (await request.json().catch(() => ({}))) as {
        agentTypes?: unknown;
        runtime?: unknown;
        providers?: unknown;
        forgeAvailable?: unknown;
        repos?: unknown;
      };
      const caller = await createPublicApiCaller(request);
      const result = await caller.publicApi.heartbeat({
        workspaceId,
        agentTypes: Array.isArray(body.agentTypes)
          ? body.agentTypes
          : undefined,
        runtime: parseRuntime(body.runtime),
        providers: Array.isArray(body.providers) ? body.providers : undefined,
        forgeAvailable:
          typeof body.forgeAvailable === "boolean"
            ? body.forgeAvailable
            : undefined,
        repos: Array.isArray(body.repos) ? body.repos : undefined,
      });
      return NextResponse.json(result);
    } catch (error) {
      return errorResponse(error);
    }
  });
}

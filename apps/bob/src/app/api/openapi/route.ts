import { NextResponse } from "next/server";
import {
  generateApiDocument,
  generateFullBobApiDocument,
} from "@bob/api/openapi";
import { appRouter } from "@bob/api";
// Build-time generated from Bob's Effect-RPC contract groups
// (pnpm generate:openapi:bob). Imported as static data so the edge bundle does
// NOT pull in effect/contracts (which cannot be bundled for CF Workers — the
// same reason /api/rpc is stubbed at the edge). ~53KB gzipped.
import bobRpcSpec from "@gmacko/bob-client/openapi/bob.json";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("mode");
  const baseUrl = url.origin;

  // Default / ?mode=curated — deployed workItems-only REST routes.
  if (mode === null || mode === "curated") {
    return NextResponse.json(generateApiDocument({ baseUrl }));
  }

  // ?mode=trpc — legacy auto-generated spec from the tRPC router tree.
  // Retained until the REST bridge fully replaces the tRPC REST adapters.
  if (mode === "trpc") {
    return NextResponse.json(
      generateFullBobApiDocument(
        appRouter as unknown as Record<string, unknown>,
        { baseUrl },
      ),
    );
  }

  // ?mode=rpc — generated Effect-RPC OpenAPI 3.1 spec.
  return NextResponse.json({
    ...bobRpcSpec,
    servers: [{ url: baseUrl, description: "API Server" }],
  });
}

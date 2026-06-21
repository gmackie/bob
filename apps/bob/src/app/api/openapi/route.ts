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

  // ?mode=curated — hand-maintained workItems-only Zod spec (14 operations)
  if (mode === "curated") {
    return NextResponse.json(
      generateApiDocument({ baseUrl: "https://blder.bot" }),
    );
  }

  // ?mode=trpc — legacy auto-generated spec from the tRPC router tree.
  // Retained until the REST bridge fully replaces the tRPC REST adapters.
  if (mode === "trpc") {
    return NextResponse.json(
      generateFullBobApiDocument(
        appRouter as unknown as Record<string, unknown>,
        { baseUrl: "https://blder.bot" },
      ),
    );
  }

  // Default — the Effect-RPC OpenAPI 3.1 spec (314 operations across 8 groups),
  // the canonical source for typed clients.
  return NextResponse.json(bobRpcSpec);
}

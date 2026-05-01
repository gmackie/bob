import { NextResponse } from "next/server";
import {
  generateApiDocument,
  generateFullBobApiDocument,
} from "@bob/api/openapi";
import { appRouter } from "@bob/api";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("mode");

  // ?mode=curated returns the hand-maintained workItems-only spec (14 operations)
  // Default returns the full auto-generated spec from the tRPC router tree
  if (mode === "curated") {
    return NextResponse.json(
      generateApiDocument({ baseUrl: "https://blder.bot" }),
    );
  }

  return NextResponse.json(
    generateFullBobApiDocument(appRouter as unknown as Record<string, unknown>, {
      baseUrl: "https://blder.bot",
    }),
  );
}

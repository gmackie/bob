import { NextResponse } from "next/server";
import { generateApiDocument } from "@bob/api/openapi";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(generateApiDocument({ baseUrl: "http://localhost:3000" }));
}

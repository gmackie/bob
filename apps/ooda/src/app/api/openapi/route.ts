import { NextResponse } from "next/server";
import { generateOodaOpenApiDocument } from "@gmacko/ooda/api/openapi";

export async function GET() {
  const doc = generateOodaOpenApiDocument({
    baseUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3001",
  });
  return NextResponse.json(doc);
}

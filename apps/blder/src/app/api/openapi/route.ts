import { NextResponse } from "next/server";
import { generateApiDocument } from "@bob/api/openapi";

export async function GET() {
  return NextResponse.json(
    generateApiDocument({ baseUrl: "https://blder.bot" }),
  );
}

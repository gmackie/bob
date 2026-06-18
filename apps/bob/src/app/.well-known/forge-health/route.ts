import { NextResponse } from "next/server";

export const runtime = "edge";

export async function GET() {
  return NextResponse.json({
    status: "healthy",
    version: "1.0",
    timestamp: new Date().toISOString(),
  });
}


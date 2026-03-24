import { NextResponse } from "next/server";

const startTime = Date.now();

export async function GET() {
  const uptimeMs = Date.now() - startTime;
  const uptimeSeconds = Math.floor(uptimeMs / 1000);

  return NextResponse.json({
    status: "ok",
    version: process.env.npm_package_version ?? "0.0.4",
    uptime: uptimeSeconds,
    timestamp: new Date().toISOString(),
  });
}

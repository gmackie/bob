import { NextResponse } from "next/server";

/**
 * Previously proxied to the old gateway's /forge/register endpoint.
 * The old gateway has been removed. Forge registration now goes through
 * ForgeGraph CLI or the Go daemon.
 */
export async function POST() {
  return NextResponse.json(
    { error: "Forge registration via gateway is no longer available. Use ForgeGraph CLI." },
    { status: 410 },
  );
}

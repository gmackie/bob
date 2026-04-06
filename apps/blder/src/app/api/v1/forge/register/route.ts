import { NextResponse } from "next/server";
import { getSession } from "~/auth/server";

const GATEWAY_URL =
  process.env.GATEWAY_URL ?? process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://localhost:3002";
const BOB_API_KEY = process.env.BOB_API_KEY;

/**
 * Proxy for the gateway's /forge/register endpoint.
 * The frontend calls this route (authenticated via session cookie),
 * then this route calls the gateway with the BOB_API_KEY.
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!BOB_API_KEY) {
    return NextResponse.json(
      { error: "Forge registration not configured" },
      { status: 503 },
    );
  }

  const body = await request.json();

  const res = await fetch(`${GATEWAY_URL}/forge/register`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${BOB_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));
  return NextResponse.json(data, { status: res.status });
}

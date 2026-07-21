import type { NextRequest } from "next/server";
import {
  checkRateLimit,
  rateLimitResponse,
  setRateLimitHeaders,
} from "@bob/api/rate-limit";

import { rpcHandler } from "~/server/rpc";

const handle = async (req: NextRequest): Promise<Response> => {
  const rateLimit = checkRateLimit(req, { profile: "authenticated" });
  if (rateLimit?.limited) return rateLimitResponse(rateLimit);
  return setRateLimitHeaders(await rpcHandler(req), rateLimit);
};

export async function GET(req: NextRequest): Promise<Response> {
  return handle(req);
}

export async function POST(req: NextRequest): Promise<Response> {
  return handle(req);
}

import type { NextRequest } from "next/server";

import { rpcHandler } from "~/server/rpc";

export async function GET(req: NextRequest): Promise<Response> {
  return rpcHandler(req);
}

export async function POST(req: NextRequest): Promise<Response> {
  return rpcHandler(req);
}

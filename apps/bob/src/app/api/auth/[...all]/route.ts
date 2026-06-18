import type { NextRequest } from "next/server";

import { auth } from "~/auth/server";

export const GET = (request: NextRequest, _ctx: { params: Promise<{ all: string[] }> }) =>
  auth.handler(request);

export const POST = (request: NextRequest, _ctx: { params: Promise<{ all: string[] }> }) =>
  auth.handler(request);

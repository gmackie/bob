import { NextResponse } from "next/server";
import {
  createPublicApiCaller,
  errorResponse,
  withApiRateLimit,
} from "~/lib/rest/api-helpers";

export async function POST(request: Request) {
  return withApiRateLimit(request, async () => {
    try {
      const caller = await createPublicApiCaller(request);
      const body = (await request.json()) as Parameters<
        typeof caller.publicApi.createTask
      >[0];
      const idempotencyKey = request.headers.get("idempotency-key");
      if (!idempotencyKey || idempotencyKey !== body.idempotencyKey) {
        return NextResponse.json(
          { error: "Idempotency-Key must match the approved intake payload" },
          { status: 400 },
        );
      }
      return NextResponse.json(await caller.publicApi.createTask(body));
    } catch (error) {
      return errorResponse(error);
    }
  });
}

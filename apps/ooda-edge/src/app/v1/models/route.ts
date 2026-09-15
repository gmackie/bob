import { validateApiKey } from "@gmacko/core/auth/validate-api-key";
import {
  extractBearerToken,
  listOodaOpenAiModels,
  oodaOpenAiOptionsResponse,
  withOodaOpenAiCors,
} from "@gmacko/ooda/api";
import { createTRPCContext } from "@gmacko/ooda/api";
import { auth } from "~/auth/server";
import { db } from "~/lib/db-client-lazy";

export function OPTIONS() {
  return oodaOpenAiOptionsResponse();
}

/** GET https://ooda.blder.bot/v1/models */
export async function GET(request: Request) {
  const ctx = await createTRPCContext({
    headers: request.headers,
    auth,
    db: db as unknown as Parameters<typeof createTRPCContext>[0]["db"],
  });
  const token =
    extractBearerToken(request.headers.get("authorization")) ||
    request.headers.get("x-api-key")?.trim() ||
    "";
  const result = await validateApiKey(ctx.db as never, token, undefined, null);
  if (!result.ok) {
    return withOodaOpenAiCors(
      Response.json(
        {
          error: {
            message: "Missing or invalid API key",
            type: "invalid_api_key",
          },
        },
        { status: 401 },
      ),
    );
  }

  return withOodaOpenAiCors(
    Response.json({
      object: "list",
      data: listOodaOpenAiModels(),
    }),
  );
}

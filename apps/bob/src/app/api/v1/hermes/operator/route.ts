import { validateApiKey } from "@bob/auth";
import { createHermesUsageStore } from "@bob/db";
import { db } from "@bob/db/client";

import { createHermesOperatorRuntime } from "~/lib/hermes-operator-runtime";
import {
  handleHermesOperatorRequest,
  HermesOperatorUnavailableError,
} from "~/lib/hermes-operator-route";
import { withApiRateLimit } from "~/lib/rest/api-helpers";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

async function postOperator(request: Request): Promise<Response> {
  return handleHermesOperatorRequest(request, {
    authenticate: validateApiKey,
    authorize: (auth) => {
      const ownerUserId = process.env.HERMES_OPERATOR_OWNER_USER_ID;
      return !ownerUserId || auth.userId === ownerUserId;
    },
    createService: (auth) => {
      try {
        return createHermesOperatorRuntime(
          {
            ownerUserId: requiredEnv("HERMES_OPERATOR_OWNER_USER_ID"),
            oodaOrigin: requiredEnv("HERMES_OODA_ORIGIN_URL"),
            oodaApiKey: requiredEnv("HERMES_OODA_API_KEY"),
            conversationId: requiredEnv("HERMES_OODA_CONVERSATION_ID"),
            branchId: requiredEnv("HERMES_OODA_BRANCH_ID"),
            digestSecret: requiredEnv("HERMES_USAGE_DIGEST_SECRET"),
          },
          { usage: createHermesUsageStore(db) },
        ).createService(auth);
      } catch (error) {
        console.error("[hermes-operator] runtime unavailable", {
          name: error instanceof Error ? error.name : "UnknownError",
        });
        throw new HermesOperatorUnavailableError();
      }
    },
  });
}

export async function POST(request: Request): Promise<Response> {
  return withApiRateLimit(
    request,
    () => postOperator(request),
    "authenticated",
  );
}

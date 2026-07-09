import type { NextRequest } from "next/server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { getHTTPStatusCodeFromError } from "@trpc/server/http";
import * as Sentry from "@sentry/cloudflare";
import {
  buildFailurePayload,
  getFailureSentryTags,
  type FailureContext,
} from "@bob/observability/failures";

import { createTRPCContext } from "@bob/api";

import { edgeRouter } from "~/lib/edge-router";
import { authBundle } from "~/auth/server";

function reportApiFailure(context: FailureContext) {
  const payload = buildFailurePayload(context);
  const tags = getFailureSentryTags(context);
  console.error(
    `[observability] critical ${context.surface} failure: ${context.operation}`,
    payload,
  );
  Sentry.withScope((scope) => {
    scope.setLevel("error");
    scope.setTags(tags);
    scope.setContext("failure", payload);
    const err =
      context.error instanceof Error
        ? context.error
        : new Error(
            typeof context.error === "string" ? context.error : "API failure",
          );
    Sentry.captureException(err);
  });
}

const setCorsHeaders = (res: Response) => {
  res.headers.set("Access-Control-Allow-Origin", "*");
  res.headers.set("Access-Control-Request-Method", "*");
  res.headers.set("Access-Control-Allow-Methods", "OPTIONS, GET, POST");
  res.headers.set("Access-Control-Allow-Headers", "*");
};

export const OPTIONS = () => {
  const response = new Response(null, { status: 204 });
  setCorsHeaders(response);
  return response;
};

const handler = async (req: NextRequest) => {
  const response = await fetchRequestHandler({
    endpoint: "/api/trpc",
    router: edgeRouter,
    req,
    createContext: () =>
      createTRPCContext({
        authBundle,
        headers: req.headers,
      }),
    onError({ error, path, ctx }) {
      // Only surface genuine server faults (5xx). Expected client errors
      // (UNAUTHORIZED, NOT_FOUND, BAD_REQUEST, ...) are normal traffic and
      // would otherwise flood logs/Sentry and bury real failures.
      if (getHTTPStatusCodeFromError(error) >= 500) {
        console.error(`>>> tRPC Error on '${path}'`, error);
        const userId = ctx?.session?.user?.id;
        reportApiFailure({
          surface: "api",
          operation: path ?? "unknown",
          error,
          alertId: "api-trpc-5xx",
          user: userId ? { userId } : undefined,
          tenant: process.env.BOB_TENANT_ID
            ? { tenantId: process.env.BOB_TENANT_ID }
            : undefined,
        });
      }
    },
  });

  setCorsHeaders(response);
  return response;
};

export const GET = (req: NextRequest, ctx: { params: Promise<{ trpc: string }> }) => handler(req);
export const POST = (req: NextRequest, ctx: { params: Promise<{ trpc: string }> }) => handler(req);

import type { NextRequest } from "next/server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";

import { createTRPCContext } from "@bob/api";
import { captureException, initObservability } from "@bob/monitoring/server";

import { edgeRouter } from "~/lib/edge-router";
import { auth } from "~/auth/server";

void initObservability({ serviceName: "blder-api" });

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
        auth: auth,
        headers: req.headers,
      }),
    onError({ error, path }) {
      console.error(`>>> tRPC Error on '${path}'`, error);
      void captureException(error, {
        serviceName: "blder-api",
        operation: "trpc-adapter",
        route: path ?? "unknown",
      });
    },
  });

  setCorsHeaders(response);
  return response;
};

export const GET = (req: NextRequest, ctx: { params: Promise<{ trpc: string }> }) => handler(req);
export const POST = (req: NextRequest, ctx: { params: Promise<{ trpc: string }> }) => handler(req);

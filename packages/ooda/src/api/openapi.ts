import {
  createOpenApiFetchHandler,
  generateOpenApiDocument,
} from "trpc-to-openapi";

import { edgeRouter } from "./edge-router";
import { appRouter } from "./root";
import type { createTRPCContext } from "./trpc";

type OodaApiContext = Awaited<ReturnType<typeof createTRPCContext>>;
type HttpHandlerInput = {
  request: Request;
  createContext: () => Promise<OodaApiContext> | OodaApiContext;
};

export function generateOodaOpenApiDocument(opts: { baseUrl?: string } = {}) {
  const baseUrl = opts.baseUrl ?? "http://localhost:3001";
  return generateOpenApiDocument(appRouter, {
    title: "OODA Research API",
    version: "0.1.0",
    baseUrl,
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        description: "Session token from better-auth",
      },
      runnerAuth: {
        type: "http",
        scheme: "bearer",
        description: "OODA_RUNNER_SECRET shared secret",
      },
    },
  });
}

export function handleOodaV1HttpRequest(input: HttpHandlerInput) {
  return createOpenApiFetchHandler({
    endpoint: "/",
    router: appRouter,
    req: input.request,
    createContext: input.createContext,
  });
}

export function handleOodaV1EdgeHttpRequest(input: HttpHandlerInput) {
  return createOpenApiFetchHandler({
    endpoint: "/",
    router: edgeRouter,
    req: input.request,
    createContext: input.createContext,
  });
}

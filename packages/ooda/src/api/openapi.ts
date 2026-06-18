import { generateOpenApiDocument } from "trpc-to-openapi";

import { appRouter } from "./root";

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

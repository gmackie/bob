import { createTRPCClient, httpBatchLink, type TRPCClient } from "@trpc/client";
import SuperJSON from "superjson";

import type { AppRouter } from "@gmacko/ooda/api";

export function createRunnerTRPCClient(serverUrl: string): TRPCClient<AppRouter> {
  return createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        transformer: SuperJSON,
        url: `${serverUrl}/api/trpc`,
        headers() {
          const h: Record<string, string> = { "x-trpc-source": "runner" };
          if (process.env.OODA_RUNNER_SECRET) {
            h["authorization"] = `Bearer ${process.env.OODA_RUNNER_SECRET}`;
          }
          return h;
        },
      }),
    ],
  });
}

export type RunnerTRPCClient = ReturnType<typeof createRunnerTRPCClient>;

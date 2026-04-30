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
          return {
            "x-trpc-source": "runner",
          };
        },
      }),
    ],
  });
}

export type RunnerTRPCClient = ReturnType<typeof createRunnerTRPCClient>;

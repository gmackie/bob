import { createTRPCClient, httpBatchLink, type TRPCClient } from "@trpc/client";
import SuperJSON from "superjson";

import type { AppRouter } from "@gmacko/ooda/api";
import type { ResearchTRPCSurface } from "@gmacko/ooda/buddy-tools";

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

/**
 * Adapt the tRPC client's `research` router into the flat
 * `ResearchTRPCSurface` the buddy-tool handlers call. Each surface method is
 * a `(input) => Promise<output>` bound to the matching procedure's
 * `.query()` / `.mutate()` callable (query vs mutation matches the router
 * definitions in `packages/ooda/src/api/router/research/*`).
 */
export function createResearchSurface(
  trpc: RunnerTRPCClient,
): ResearchTRPCSurface {
  const r = trpc.research;
  return {
    diveSpawn: (input) => r.diveSpawn.mutate(input),
    diveStatus: (input) => r.diveStatus.query(input),
    diveResults: (input) => r.diveResults.query(input),
    linksByThread: (input) => r.linksByThread.query(input),
    inboxByThread: (input) => r.inboxByThread.query(input),
    inboxTriage: (input) => r.inboxTriage.mutate(input),
    interestRegister: (input) => r.interestRegister.mutate(input),
    interestList: (input) => r.interestList.query(input),
    interestDisable: (input) => r.interestDisable.mutate(input),
    kbPromoteRequest: (input) => r.kbPromoteRequest.mutate(input),
    toolCallLogInsert: (input) => r.toolCallLogInsert.mutate(input),
    toolCallLogFinish: (input) => r.toolCallLogFinish.mutate(input),
    paperNeighborhood: (input) => r.paperNeighborhood.query(input),
    paperPath: (input) => r.paperPath.query(input),
    papersSearchVault: (input) => r.papersSearchVault.query(input),
    paperById: (input) => r.paperById.query(input),
    threadMemorySearch: (input) => r.threadMemorySearch.query(input),
    threadMemoryUpdate: (input) => r.threadMemoryUpdate.mutate(input),
  };
}

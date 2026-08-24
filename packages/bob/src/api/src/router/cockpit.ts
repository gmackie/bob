import type { TRPCRouterRecord } from "@trpc/server";
import { z } from "zod/v4";

import { cockpitStatus } from "../handlers/cockpitStatus";
import { protectedProcedure } from "../trpc";

/**
 * /cockpit data. Read-only in V1; the wall polls `status` every ~10 s and on
 * workspace broadcasts. Controls (stop/retry/bump/pause/…) arrive in V2 as
 * owner-only mutations on this same router.
 */
export const cockpitRouter = {
  status: protectedProcedure
    .input(
      z
        .object({
          includeOoda: z.boolean().default(false),
        })
        .default({ includeOoda: false }),
    )
    .query(({ input }) =>
      cockpitStatus({
        includeOoda: input.includeOoda,
        forgejoToken: process.env.BOB_FORGEJO_TOKEN,
        forgejoInstanceUrl: process.env.BOB_FORGEJO_INSTANCE_URL ?? "https://git.forgegraf.com",
        rotation: (process.env.BOB_AUTO_DRAIN_AGENTS ?? "claude,codex,grok,cursor")
          .split(",")
          .map((a: string) => a.trim())
          .filter(Boolean),
        repairCap: Number(process.env.BOB_AUTO_REPAIR_MAX_ATTEMPTS_PER_PR ?? 3),
      }),
    ),
} satisfies TRPCRouterRecord;

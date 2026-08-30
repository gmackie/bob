import type { TRPCRouterRecord } from "@trpc/server";
import { z } from "zod/v4";

import { protectedProcedure } from "../trpc";
import {
  AGENT_AUTH_PROVIDERS,
  agentAuthCancel,
  agentAuthStart,
  agentAuthSubmitCode,
} from "../handlers/agentAuth";

const providerSchema = z.enum(AGENT_AUTH_PROVIDERS);
// Generated client-side so the browser can correlate the async prompt that
// comes back over the workspace socket with the request it started.
const requestIdSchema = z.string().min(8).max(64);

export const agentAuthRouter = {
  /** Begin an interactive login on the workspace's host. */
  start: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string().uuid(),
        provider: providerSchema,
        requestId: requestIdSchema,
      }),
    )
    .mutation(({ ctx, input }) =>
      agentAuthStart({ db: ctx.db, userId: ctx.session.user.id } as never, input),
    ),

  /** Hand the operator's pasted code to the waiting CLI. */
  submitCode: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string().uuid(),
        requestId: requestIdSchema,
        // Codes are short; a cap keeps an oversized paste from reaching the host.
        value: z.string().min(1).max(512),
      }),
    )
    .mutation(({ ctx, input }) =>
      agentAuthSubmitCode({ db: ctx.db, userId: ctx.session.user.id } as never, input),
    ),

  cancel: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid(), requestId: requestIdSchema }))
    .mutation(({ ctx, input }) =>
      agentAuthCancel({ db: ctx.db, userId: ctx.session.user.id } as never, input),
    ),
} satisfies TRPCRouterRecord;

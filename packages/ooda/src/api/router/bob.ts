import type { RouterRecord } from "@trpc/server/unstable-core-do-not-import";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { authedProcedure } from "../trpc";
import { resolveBobDispatchConfig } from "./bob-config.js";

// OODA -> Bob dispatch caller (Phase 5 M1, OODA side). A thread action dispatches
// an executable Bob run via Bob's public REST endpoint. The reverse direction
// (Bob run outcome -> OODA thread note) is handled runner-side by promoteNote.
//
// Config-driven and dark until configured: dispatch requires BOB_API_URL,
// BOB_API_KEY (a bob_live_* key), and BOB_WORKSPACE_ID. Missing any -> a clear
// PRECONDITION_FAILED, so the procedure exists but can't fire until wired up.

export const bobRouter = {
  dispatch: authedProcedure
    .meta({
      openapi: { method: "POST", path: "/api/bob/dispatch", tags: ["bob"], protect: true },
    })
    .input(
      z.object({
        /** Thread workspace directory the run's outcome note lands in. */
        threadSlug: z.string().min(1).max(200),
        /** Thread UUID for provenance/entity extraction (optional). */
        threadId: z.string().max(200).optional(),
        title: z.string().min(1).max(500),
        description: z.string().max(20000).optional(),
        agentType: z.string().min(1).max(64).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const config = resolveBobDispatchConfig(process.env);
      if (!config) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "Bob dispatch is not configured. Set BOB_API_URL, BOB_API_KEY (a bob_live_* key), and BOB_WORKSPACE_ID.",
        });
      }

      const res = await fetch(`${config.apiUrl}/api/v1/dispatch`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          workspaceId: config.workspaceId,
          title: input.title,
          description: input.description,
          agentType: input.agentType,
          ooda: { threadSlug: input.threadSlug, threadId: input.threadId },
        }),
      });

      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new TRPCError({
          // 403 = Bob's dispatch is gated off (BOB_OODA_DISPATCH_ENABLED); surface it plainly.
          code: res.status === 403 ? "FORBIDDEN" : "BAD_GATEWAY",
          message: `Bob dispatch failed (${res.status}): ${detail.slice(0, 300)}`,
        });
      }

      return (await res.json()) as {
        sessionId: string;
        workItemId: string;
        identifier: string;
        status: string;
      };
    }),
} satisfies RouterRecord;

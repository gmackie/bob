import type { RouterRecord } from "@trpc/server/unstable-core-do-not-import";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { authedProcedure } from "../trpc";
import { resolveBobDispatchConfig } from "./bob-config.js";

const BobDispatchOutputSchema = z.object({
  sessionId: z.string(),
  workItemId: z.string(),
  identifier: z.string(),
  status: z.string(),
});

const BobProjectOutputSchema = z.object({
  projectId: z.string(),
  key: z.string(),
  name: z.string(),
  workItems: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
    }),
  ),
  scaffold: z
    .object({
      sessionId: z.string(),
      identifier: z.string(),
      status: z.string(),
    })
    .nullable(),
});

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
    .output(BobDispatchOutputSchema)
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

  // "Make it a project": create a Bob (linear-clone) project + seed backlog
  // tasks, and optionally scaffold a new app via create-gmacko-app as an
  // executable Bob dispatch. Same config/env as dispatch.
  createProject: authedProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/api/bob/create-project",
        tags: ["bob"],
        protect: true,
      },
    })
    .input(
      z.object({
        threadSlug: z.string().min(1).max(200),
        threadId: z.string().max(200).optional(),
        name: z.string().min(1).max(128),
        description: z.string().max(20000).optional(),
        tasks: z.array(z.string().min(1).max(256)).max(20).optional(),
        scaffold: z.boolean().optional(),
      }),
    )
    .output(BobProjectOutputSchema)
    .mutation(async ({ input }) => {
      const config = resolveBobDispatchConfig(process.env);
      if (!config) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "Bob dispatch is not configured. Set BOB_API_URL, BOB_API_KEY (a bob_live_* key), and BOB_WORKSPACE_ID.",
        });
      }

      // 1. Create the project + seed backlog tasks.
      const res = await fetch(`${config.apiUrl}/api/v1/projects`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          workspaceId: config.workspaceId,
          name: input.name,
          description: input.description,
          tasks: input.tasks,
        }),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new TRPCError({
          code: res.status === 403 ? "FORBIDDEN" : "BAD_GATEWAY",
          message: `Bob project create failed (${res.status}): ${detail.slice(0, 300)}`,
        });
      }
      const project = (await res.json()) as {
        projectId: string;
        key: string;
        name: string;
        workItems: { id: string; title: string }[];
      };

      // 2. Optionally scaffold a new app via create-gmacko-app, as an executable
      // dispatch. Non-fatal: a scaffold failure leaves the project + tasks intact.
      let scaffold:
        | { sessionId: string; identifier: string; status: string }
        | null = null;
      if (input.scaffold) {
        try {
          const dres = await fetch(`${config.apiUrl}/api/v1/dispatch`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${config.apiKey}`,
            },
            body: JSON.stringify({
              workspaceId: config.workspaceId,
              title: `Scaffold ${input.name} (${project.key})`,
              // Fresh per-project dir, outside the bob monorepo (so the scaffold
              // creates a standalone app and no stray PR against bob).
              workingDirectory: "/home/bob/dev/projects",
              description:
                `You are in /home/bob/dev/projects. Create a new subdirectory named ` +
                `"${project.key.toLowerCase()}" and scaffold a new gmacko app named "${input.name}" ` +
                "inside it using create-gmacko-app (the create-gmacko-app-workflow skill / " +
                "`npm create gmacko-app`). Set up the standard monorepo structure " +
                `(apps, packages/ui|api|db, docs/ai).\n\n` +
                `Then make it its own project: (1) \`git init\` the new app dir and make an initial ` +
                `commit; (2) register it as a ForgeGraph app named "${project.key.toLowerCase()}" with ` +
                `the fg CLI (\`~/.forgegraph/bin/fg app create ${project.key.toLowerCase()}\` — check ` +
                `\`~/.forgegraph/bin/fg app create --help\` for exact flags) and create its git repo on ` +
                `git.forgegraf.com, pushing the initial commit. If the fg CLI or its credentials are ` +
                `unavailable, stop and report that clearly rather than guessing. This is the scaffold ` +
                `for project ${project.key}.`,
              agentType: "claude",
              ooda: { threadSlug: input.threadSlug, threadId: input.threadId },
            }),
          });
          if (dres.ok) {
            scaffold = (await dres.json()) as {
              sessionId: string;
              identifier: string;
              status: string;
            };
          }
        } catch {
          // Leave scaffold null; the project + tasks already succeeded.
        }
      }

      return { ...project, scaffold };
    }),
} satisfies RouterRecord;

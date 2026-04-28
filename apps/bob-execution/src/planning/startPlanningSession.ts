import { eq } from "@bob/db";
import { db } from "@bob/db/client";
import { chatConversations, runLifecycleEvents, taskRuns } from "@bob/db/schema";

import {
  buildPlanningPrompt,
  type PlanningContext,
  type PlanningLaunchContext,
} from "./planningAgentTools";
import { buildSmolAgentPlanningProfile } from "./smolAgentPlanningProfile";
import { buildSmolAgentShapeProfile } from "./smolAgentShapeProfile";

interface StartPlanningInput {
  userId: string;
  workspaceId: string;
  projectId: string;
  projectName: string;
  sessionId: string;
  workingDirectory: string;
  reactFrontend?: boolean;
  launchContext?: PlanningLaunchContext;
}

export async function startPlanningSession(
  input: StartPlanningInput,
): Promise<{ sessionId: string }> {
  const ctx: PlanningContext = {
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    projectName: input.projectName,
    sessionId: input.sessionId,
    reactFrontend: input.reactFrontend ?? false,
    launchContext: input.launchContext,
  };

  const prompt = buildPlanningPrompt(ctx);

  const isShapeIntent = input.launchContext?.intent === "shape";

  const profile = isShapeIntent
    ? buildSmolAgentShapeProfile({
        sessionId: input.sessionId,
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        projectName: input.projectName,
        workingDirectory: input.workingDirectory,
        workItemId: input.launchContext?.workItem?.id ?? "",
        workItemTitle: input.launchContext?.workItem?.title ?? input.projectName,
      })
    : buildSmolAgentPlanningProfile({
        sessionId: input.sessionId,
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        projectName: input.projectName,
        workingDirectory: input.workingDirectory,
      });

  const agentType: string = profile.agentType;
  const phase = isShapeIntent ? "shape" : "plan";

  console.log(
    `[planning] Starting ${phase} session ${input.sessionId} with ${agentType} for project "${input.projectName}"`,
  );

  // Set session to pending — the daemon picks it up via nudge or polling.
  await db
    .update(chatConversations)
    .set({ status: "pending", agentType })
    .where(eq(chatConversations.id, input.sessionId));

  // Nudge ws-gateway so the daemon picks up the session immediately.
  const gatewayUrl = process.env.GATEWAY_URL ?? "http://localhost:3002";
  const nudgeSecret = process.env.NUDGE_SHARED_SECRET;
  if (nudgeSecret) {
    try {
      await fetch(`${gatewayUrl}/internal/nudge`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${nudgeSecret}`,
        },
        body: JSON.stringify({
          sessionId: input.sessionId,
          workspaceId: input.workspaceId,
          workingDirectory: input.workingDirectory,
          agentType,
          title: `${phase}: ${input.projectName}`,
          sessionType: phase,
        }),
      });
    } catch (err) {
      console.warn("[planning] nudge failed:", err);
    }
  }

  // Fire-and-forget: write run_started lifecycle event
  void (async () => {
    try {
      const taskRun = await db.query.taskRuns.findFirst({
        where: eq(taskRuns.sessionId, input.sessionId),
        columns: { id: true, workItemId: true },
      });
      if (taskRun) {
        await db.insert(runLifecycleEvents).values({
          taskRunId: taskRun.id,
          workItemId: taskRun.workItemId ?? undefined,
          sessionId: input.sessionId,
          eventType: "run_started",
          phase,
          metadata: { agentType: profile.agentType, projectName: input.projectName },
        });
      }
    } catch (err) {
      console.warn("[planning] Failed to write run_started lifecycle event:", err);
    }
  })();

  return { sessionId: input.sessionId };
}

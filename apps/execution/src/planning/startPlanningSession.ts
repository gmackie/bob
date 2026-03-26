import { eq } from "@bob/db";
import { db } from "@bob/db/client";
import { chatConversations, runLifecycleEvents, taskRuns } from "@bob/db/schema";

import { gatewayRequest } from "../runtime/taskExecutor";
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

  console.log(
    `[planning] Starting ${isShapeIntent ? "shape" : "planning"} session ${input.sessionId} with ${profile.agentType} for project "${input.projectName}"`,
  );

  // Start the session on the gateway with smol-agent
  await gatewayRequest(input.userId, "/session/start", {
    sessionId: input.sessionId,
    workingDirectory: input.workingDirectory,
    agentType: profile.agentType,
    initialPrompt: prompt,
    env: {
      ...profile.env,
      BOB_API_URL: process.env.BOB_API_URL ?? "http://localhost:3000",
      ...(process.env.BOB_API_KEY
        ? { BOB_API_KEY: process.env.BOB_API_KEY }
        : {}),
    },
  });

  // Update session status
  await db
    .update(chatConversations)
    .set({ status: "running" })
    .where(eq(chatConversations.id, input.sessionId));

  // Fire-and-forget: write run_started lifecycle event
  const phase = isShapeIntent ? "shape" : "plan";
  void (async () => {
    try {
      // Look up the taskRun associated with this session (if any)
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

import { eq } from "@bob/db";
import { db } from "@bob/db/client";
import { chatConversations } from "@bob/db/schema";

import { gatewayRequest } from "../runtime/taskExecutor";
import {
  buildPlanningPrompt,
  type PlanningContext,
  type PlanningLaunchContext,
} from "./planningAgentTools";

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

  // Start the session on the gateway
  await gatewayRequest(input.userId, "/session/start", {
    sessionId: input.sessionId,
    workingDirectory: input.workingDirectory,
    agentType: "claude",
    initialPrompt: prompt,
  });

  // Update session status
  await db
    .update(chatConversations)
    .set({ status: "running" })
    .where(eq(chatConversations.id, input.sessionId));

  return { sessionId: input.sessionId };
}

import { eq } from "@bob/db";
import { db } from "@bob/db/client";
import { chatConversations } from "@bob/db/schema";

import { gatewayRequest } from "../runtime/taskExecutor";
import { buildPlanningPrompt, type PlanningContext } from "./planningAgentTools";

interface StartPlanningInput {
  userId: string;
  workspaceId: string;
  projectId: string;
  projectName: string;
  sessionId: string;
  workingDirectory: string;
}

export async function startPlanningSession(
  input: StartPlanningInput,
): Promise<{ sessionId: string }> {
  const ctx: PlanningContext = {
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    projectName: input.projectName,
    sessionId: input.sessionId,
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

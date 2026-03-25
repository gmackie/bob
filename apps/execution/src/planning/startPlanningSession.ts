import { eq } from "@bob/db";
import { db } from "@bob/db/client";
import { chatConversations } from "@bob/db/schema";

import { gatewayRequest } from "../runtime/taskExecutor";
import {
  buildPlanningPrompt,
  type PlanningContext,
  type PlanningLaunchContext,
} from "./planningAgentTools";
import { buildSmolAgentPlanningProfile } from "./smolAgentPlanningProfile";

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

  const profile = buildSmolAgentPlanningProfile({
    sessionId: input.sessionId,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    projectName: input.projectName,
    workingDirectory: input.workingDirectory,
  });

  console.log(
    `[planning] Starting planning session ${input.sessionId} with ${profile.agentType} for project "${input.projectName}"`,
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

  return { sessionId: input.sessionId };
}

import { NextRequest, NextResponse } from "next/server";

import type { AgentType } from "@bob/legacy";

import { getSession } from "~/auth/server";
import { getServices } from "~/server/services";

export async function GET() {
  try {
    const session = await getSession();
    const userId = session?.user?.id ?? "default-user";

    const { agentService } = await getServices();
    const instances = agentService.getInstances(userId);

    return NextResponse.json(instances);
  } catch (error) {
    console.error("Failed to get instances:", error);
    return NextResponse.json(
      { error: "Failed to get instances" },
      { status: 500 },
    );
  }
}

interface StartInstanceBody {
  worktreeId: string;
  agentType?: AgentType;
}

export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    const userId = session?.user?.id ?? "default-user";

    const body = (await request.json()) as StartInstanceBody;
    const { worktreeId, agentType } = body;

    if (!worktreeId) {
      return NextResponse.json(
        { error: "worktreeId is required" },
        { status: 400 },
      );
    }

    const { agentService } = await getServices();
    const instance = await agentService.startInstance(
      worktreeId,
      agentType ?? "claude",
      userId,
    );

    return NextResponse.json(instance, { status: 201 });
  } catch (error) {
    console.error("Failed to start instance:", error);
    return NextResponse.json(
      { error: `Failed to start instance: ${error}` },
      { status: 500 },
    );
  }
}

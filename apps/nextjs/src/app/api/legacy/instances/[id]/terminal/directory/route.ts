import { NextRequest, NextResponse } from "next/server";

import { getSession } from "~/auth/server";
import { getServices } from "~/server/services";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const session = await getSession();
    const userId = session?.user?.id ?? "default-user";

    const { agentService, gitService, terminalService } = await getServices();
    const instance = agentService.getInstance(id, userId);

    if (!instance) {
      return NextResponse.json(
        { error: "Instance not found" },
        { status: 404 },
      );
    }

    const worktree = gitService.getWorktree(instance.worktreeId, userId);
    if (!worktree) {
      return NextResponse.json(
        { error: "Worktree not found" },
        { status: 404 },
      );
    }

    const session_ = terminalService.createSession(id, worktree.path);
    return NextResponse.json({ sessionId: session_.id });
  } catch (error) {
    console.error("Failed to create directory terminal session:", error);
    return NextResponse.json(
      { error: `Failed to create directory terminal session: ${error}` },
      { status: 500 },
    );
  }
}

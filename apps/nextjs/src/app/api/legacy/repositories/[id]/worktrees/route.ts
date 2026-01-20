import { NextRequest, NextResponse } from "next/server";

import type { AgentType } from "@bob/legacy";

import { getSession } from "~/auth/server";
import { getServices } from "~/server/services";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const session = await getSession();
    const userId = session?.user?.id ?? "default-user";

    const { gitService } = await getServices();
    const worktrees = gitService.getWorktreesByRepository(id, userId);

    return NextResponse.json(worktrees);
  } catch (error) {
    console.error("Failed to get worktrees:", error);
    return NextResponse.json(
      { error: "Failed to get worktrees" },
      { status: 500 },
    );
  }
}

interface CreateWorktreeBody {
  branchName: string;
  baseBranch?: string;
  agentType?: AgentType;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const session = await getSession();
    const userId = session?.user?.id ?? "default-user";

    const body = (await request.json()) as CreateWorktreeBody;
    const { branchName, baseBranch, agentType } = body;

    if (!branchName) {
      return NextResponse.json(
        { error: "branchName is required" },
        { status: 400 },
      );
    }

    const { gitService } = await getServices();
    const worktree = await gitService.createWorktree(
      id,
      branchName,
      baseBranch,
      agentType,
      userId,
    );

    return NextResponse.json(worktree, { status: 201 });
  } catch (error) {
    console.error("Failed to create worktree:", error);
    return NextResponse.json(
      { error: `Failed to create worktree: ${error}` },
      { status: 500 },
    );
  }
}

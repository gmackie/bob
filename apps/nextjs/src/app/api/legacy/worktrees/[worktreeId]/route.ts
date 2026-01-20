import { NextRequest, NextResponse } from "next/server";

import { getSession } from "~/auth/server";
import { getServices } from "~/server/services";

interface RouteParams {
  params: Promise<{ worktreeId: string }>;
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { worktreeId } = await params;

    const { gitService } = await getServices();
    const mergeStatus = await gitService.checkBranchMergeStatus(worktreeId);

    return NextResponse.json(mergeStatus);
  } catch (error) {
    console.error("Failed to check merge status:", error);
    return NextResponse.json(
      { error: `Failed to check merge status: ${error}` },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { worktreeId } = await params;
    const session = await getSession();
    const userId = session?.user?.id ?? "default-user";

    const { searchParams } = new URL(request.url);
    const force = searchParams.get("force") === "true";

    const { gitService, agentService } = await getServices();

    if (force) {
      const instances = agentService.getInstancesByWorktree(worktreeId, userId);
      for (const instance of instances) {
        if (instance.status === "running" || instance.status === "starting") {
          console.log(
            `Force delete: stopping instance ${instance.id} (${instance.agentType}) for worktree ${worktreeId}`,
          );
          await agentService.stopInstance(instance.id);
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 1000));

      const worktree = gitService.getWorktree(worktreeId, userId);
      if (worktree) {
        const updatedInstances = agentService.getInstancesByWorktree(
          worktreeId,
          userId,
        );
        worktree.instances = updatedInstances;
      }
    }

    await gitService.removeWorktree(worktreeId, force);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error("Failed to remove worktree:", error);
    return NextResponse.json(
      { error: `Failed to remove worktree: ${error}` },
      { status: 500 },
    );
  }
}

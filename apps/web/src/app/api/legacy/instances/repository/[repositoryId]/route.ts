import { NextRequest, NextResponse } from "next/server";

import { getSession } from "~/auth/server";
import { getServices } from "~/server/services";

interface RouteParams {
  params: Promise<{ repositoryId: string }>;
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { repositoryId } = await params;
    const session = await getSession();
    const userId = session?.user?.id ?? "default-user";

    const { agentService } = await getServices();
    const instances = agentService.getInstancesByRepository(
      repositoryId,
      userId,
    );

    return NextResponse.json(instances);
  } catch (error) {
    console.error("Failed to get instances for repository:", error);
    return NextResponse.json(
      { error: "Failed to get instances for repository" },
      { status: 500 },
    );
  }
}

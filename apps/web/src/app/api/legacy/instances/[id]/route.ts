import { NextRequest, NextResponse } from "next/server";

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

    const { agentService } = await getServices();
    const instance = agentService.getInstance(id, userId);

    if (!instance) {
      return NextResponse.json(
        { error: "Instance not found" },
        { status: 404 },
      );
    }

    return NextResponse.json(instance);
  } catch (error) {
    console.error("Failed to get instance:", error);
    return NextResponse.json(
      { error: "Failed to get instance" },
      { status: 500 },
    );
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;

    const { agentService } = await getServices();
    await agentService.deleteInstance(id);

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error("Failed to delete instance:", error);
    return NextResponse.json(
      { error: `Failed to delete instance: ${error}` },
      { status: 500 },
    );
  }
}

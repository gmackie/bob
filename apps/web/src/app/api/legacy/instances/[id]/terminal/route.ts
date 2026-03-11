import { NextRequest, NextResponse } from "next/server";

import type { TerminalSession } from "@bob/legacy/services";

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

    const { agentService, terminalService } = await getServices();
    const instance = agentService.getInstance(id, userId);

    if (!instance) {
      return NextResponse.json(
        { error: "Instance not found" },
        { status: 404 },
      );
    }

    if (instance.status !== "running") {
      return NextResponse.json(
        {
          error: `Cannot connect to agent terminal. Instance is ${instance.status}. Please start the instance first.`,
        },
        { status: 400 },
      );
    }

    const agentPty = agentService.getAgentPty(id);
    if (!agentPty) {
      return NextResponse.json(
        {
          error:
            "Agent terminal not available. The process may have stopped unexpectedly.",
        },
        { status: 404 },
      );
    }

    const session_ = terminalService.createAgentPtySession(id, agentPty);
    return NextResponse.json({
      sessionId: session_.id,
      agentType: instance.agentType,
    });
  } catch (error) {
    console.error("Failed to create terminal session:", error);
    return NextResponse.json(
      { error: `Failed to create terminal session: ${error}` },
      { status: 500 },
    );
  }
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;

    const { terminalService } = await getServices();
    const sessions = terminalService.getSessionsByInstance(id);

    return NextResponse.json(
      sessions.map((s: TerminalSession) => ({
        id: s.id,
        createdAt: s.createdAt,
        type: s.claudePty ? "claude" : s.pty ? "directory" : "unknown",
      })),
    );
  } catch (error) {
    console.error("Failed to get terminal sessions:", error);
    return NextResponse.json(
      { error: "Failed to get terminal sessions" },
      { status: 500 },
    );
  }
}

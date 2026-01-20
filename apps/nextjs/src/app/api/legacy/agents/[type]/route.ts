import { NextRequest, NextResponse } from "next/server";

import type { AgentType } from "@bob/legacy";
import { agentFactory } from "@bob/legacy/agents";

interface RouteParams {
  params: Promise<{ type: string }>;
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { type } = await params;

    const info = await agentFactory.getAgentInfoById(type as AgentType);
    if (!info) {
      return NextResponse.json(
        { error: `Agent '${type}' not found` },
        { status: 404 },
      );
    }

    return NextResponse.json(info);
  } catch (error) {
    console.error("Failed to get agent info:", error);
    return NextResponse.json(
      { error: "Failed to get agent info", details: String(error) },
      { status: 500 },
    );
  }
}

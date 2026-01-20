import { NextResponse } from "next/server";

import { agentFactory } from "@bob/legacy/agents";

export async function GET() {
  try {
    const agents = await agentFactory.getAgentInfo();
    return NextResponse.json(agents);
  } catch (error) {
    console.error("Failed to get agents:", error);
    return NextResponse.json(
      { error: "Failed to get agents", details: String(error) },
      { status: 500 },
    );
  }
}

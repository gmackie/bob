import { NextResponse } from "next/server";
export async function GET() {
  return NextResponse.json({
    appName: process.env.APP_NAME || "Bob",
    enableGithubAuth: process.env.ENABLE_GITHUB_AUTH === "true",
    jeffMode: process.env.JEFF_MODE === "true",
    allowedAgents: [],
  });
}

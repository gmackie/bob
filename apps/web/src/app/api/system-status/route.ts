import { NextResponse } from "next/server";

import { agentFactory } from "@bob/legacy/agents";
import { getAgentPathInfo, type AgentType } from "@bob/legacy";

import { spawn } from "node:child_process";

export const runtime = "nodejs";

type HostDependencyStatus = {
  name: string;
  command: string;
  isAvailable: boolean;
  version?: string;
  statusMessage?: string;
};

async function runVersionCommand(
  command: string,
  args: string[],
): Promise<{ ok: boolean; output?: string; error?: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      if (stdout.length > 4096) stdout = stdout.slice(0, 4096);
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 4096) stderr = stderr.slice(0, 4096);
    });

    const timeout = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore
      }
      resolve({ ok: false, error: "Command timeout" });
    }, 3000);

    child.on("error", (err) => {
      clearTimeout(timeout);
      resolve({ ok: false, error: err.message });
    });

    child.on("close", (code) => {
      clearTimeout(timeout);
      const output = (stdout || stderr).trim();
      resolve({ ok: (code ?? 1) === 0, output });
    });
  });
}

function parseFirstLineVersion(output: string | undefined): string | undefined {
  if (!output) return undefined;
  const firstLine = output.split("\n")[0]?.trim();
  return firstLine || undefined;
}

async function getHostDependencies(): Promise<HostDependencyStatus[]> {
  const checks: Array<{ name: string; command: string; args: string[] }> = [
    { name: "Git", command: "git", args: ["--version"] },
    { name: "GitHub CLI", command: "gh", args: ["--version"] },
    { name: "Docker", command: "docker", args: ["--version"] },
    { name: "Node.js", command: "node", args: ["--version"] },
    { name: "pnpm", command: "pnpm", args: ["--version"] },
    { name: "rsync", command: "rsync", args: ["--version"] },
  ];

  const results: HostDependencyStatus[] = [];
  for (const c of checks) {
    const res = await runVersionCommand(c.command, c.args);
    results.push({
      name: c.name,
      command: c.command,
      isAvailable: res.ok,
      version: res.ok ? parseFirstLineVersion(res.output) : undefined,
      statusMessage: res.ok ? "Available" : res.error ?? "Command failed",
    });
  }
  return results;
}

export async function GET() {
  try {
    const agents = await agentFactory.getAgentInfo();
    const hostDependencies = await getHostDependencies();

    const agentsWithPaths = agents.map((a) => ({
      ...a,
      pathInfo: getAgentPathInfo(a.type as AgentType),
    }));

    return NextResponse.json({
      timestamp: new Date().toISOString(),
      agents: agentsWithPaths,
      hostDependencies,
    });
  } catch (error) {
    console.error("Failed to compute system status:", error);
    return NextResponse.json(
      {
        error: "Failed to compute system status",
      },
      { status: 500 },
    );
  }
}

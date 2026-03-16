import type { NextApiRequest, NextApiResponse } from "next";

type AgentType =
  | "claude"
  | "cursor-agent"
  | "codex"
  | "gemini"
  | "kiro"
  | "opencode";

type SystemStatusResponse = {
  timestamp: string;
  agents: Array<{
    type: AgentType;
    name: string;
    isAvailable: boolean;
    isAuthenticated: boolean;
    authenticationStatus: string;
    statusMessage: string;
  }>;
  hostDependencies: Array<{
    name: string;
    command: string;
    isAvailable: boolean;
    version?: string;
    statusMessage: string;
  }>;
};

const AGENTS: Array<{ type: AgentType; name: string; command: string }> = [
  { type: "claude", name: "Claude", command: "claude" },
  { type: "cursor-agent", name: "Cursor Agent", command: "cursor-agent" },
  { type: "codex", name: "Codex", command: "codex" },
  { type: "gemini", name: "Gemini", command: "gemini" },
  { type: "kiro", name: "Kiro", command: "kiro" },
  { type: "opencode", name: "OpenCode", command: "opencode" },
];

const HOST_DEPENDENCIES: Array<{ name: string; command: string }> = [
  { name: "Git", command: "git" },
  { name: "GitHub CLI", command: "gh" },
  { name: "Docker", command: "docker" },
  { name: "Node.js", command: "node" },
  { name: "pnpm", command: "pnpm" },
  { name: "rsync", command: "rsync" },
];

function hasCommand(command: string): { found: boolean; version?: string } {
  try {
    const { execSync } = require("child_process");
    execSync(`which ${command}`, { encoding: "utf-8", timeout: 3000 });
    // Try to get version
    try {
      const version = execSync(`${command} --version 2>&1 || true`, {
        encoding: "utf-8",
        timeout: 5000,
      }).trim().split("\n")[0];
      return { found: true, version };
    } catch {
      return { found: true };
    }
  } catch {
    return { found: false };
  }
}

function buildSystemStatus(): SystemStatusResponse {
  return {
    timestamp: new Date().toISOString(),
    agents: AGENTS.map((agent) => {
      const check = hasCommand(agent.command);

      return {
        type: agent.type,
        name: agent.name,
        isAvailable: check.found,
        isAuthenticated: check.found,
        authenticationStatus: check.found
          ? "Detected in environment"
          : "Not detected in environment",
        statusMessage: check.found
          ? `Available${check.version ? ` (${check.version})` : ""}`
          : "Command not found",
      };
    }),
    hostDependencies: HOST_DEPENDENCIES.map((dependency) => {
      const check =
        dependency.command === "node"
          ? { found: true, version: process.version }
          : hasCommand(dependency.command);

      return {
        name: dependency.name,
        command: dependency.command,
        isAvailable: check.found,
        version: check.version,
        statusMessage: check.found
          ? `Available${check.version ? ` (${check.version})` : ""}`
          : "Command not found",
      };
    }),
  };
}

export default function handler(
  _request: NextApiRequest,
  response: NextApiResponse<SystemStatusResponse>,
) {
  response.status(200).json(buildSystemStatus());
}

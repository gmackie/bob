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

function hasCommand(command: string): boolean {
  const pathValue = (process.env.PATH ?? "").toLowerCase();
  if (!pathValue) return false;

  return pathValue.includes(command.toLowerCase());
}

function buildSystemStatus(): SystemStatusResponse {
  return {
    timestamp: new Date().toISOString(),
    agents: AGENTS.map((agent) => {
      const isAvailable = hasCommand(agent.command);

      return {
        type: agent.type,
        name: agent.name,
        isAvailable,
        isAuthenticated: isAvailable,
        authenticationStatus: isAvailable
          ? "Detected in environment"
          : "Not detected in environment",
        statusMessage: isAvailable ? "Available" : "Command not found",
      };
    }),
    hostDependencies: HOST_DEPENDENCIES.map((dependency) => {
      const isAvailable =
        dependency.command === "node" ? true : hasCommand(dependency.command);

      return {
        name: dependency.name,
        command: dependency.command,
        isAvailable,
        version: dependency.command === "node" ? process.version : undefined,
        statusMessage: isAvailable ? "Available" : "Command not found",
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

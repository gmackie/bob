import os from "node:os";
import path from "node:path";
import { existsSync } from "node:fs";

import { AgentType } from "../types.js";

const isDocker = process.env.DOCKER_ENV === "true";

// Agent binary names
const AGENT_COMMANDS: Record<AgentType, string> = {
  claude: "claude",
  codex: "codex",
  gemini: "gemini",
  opencode: "opencode",
  kiro: "kiro-cli",
  "cursor-agent": "cursor-agent",
};

/**
 * Get search paths based on environment and agent type.
 * In Docker, binaries are installed to system paths.
 * In local dev, user-level paths are preferred for auto-updates.
 */
function getSearchPaths(agentType: AgentType): string[] {
  if (isDocker) {
    // In Docker, binaries are installed to system paths
    return [
      '/usr/local/bin',
      '/usr/bin'
    ];
  }
  
  // Local development - check user-level paths first
  const paths: string[] = [];
  
  // OpenCode has its own special directory
  if (agentType === 'opencode') {
    paths.push(path.join(os.homedir(), '.opencode', 'bin'));
  }
  
  // Standard user-level paths (for claude, kiro, etc.)
  paths.push(
    path.join(os.homedir(), '.local', 'bin'),
    '/usr/local/bin',
    '/usr/bin'
  );
  
  return paths;
}

/**
 * Get the resolved command path for an agent.
 * Checks environment-specific paths and returns the first existing binary,
 * or falls back to the command name for PATH resolution.
 */
export function getAgentCommand(agentType: AgentType): string {
  const command = AGENT_COMMANDS[agentType];
  if (!command) {
    return agentType; // Fallback for unknown agent types
  }
  
  const searchPaths = getSearchPaths(agentType);
  
  // Check each path for the binary
  for (const searchPath of searchPaths) {
    const fullPath = path.join(searchPath, command);
    if (existsSync(fullPath)) {
      return fullPath;
    }
  }
  
  // Fallback to just the command name (let PATH resolve it)
  return command;
}

/**
 * Get detailed path information for debugging/status reporting
 */
export function getAgentPathInfo(agentType: AgentType): { 
  command: string; 
  resolvedPath: string | null;
  searchedPaths: string[];
  isDocker: boolean;
} {
  const command = AGENT_COMMANDS[agentType] || agentType;
  const searchPaths = getSearchPaths(agentType);
  
  for (const searchPath of searchPaths) {
    const fullPath = path.join(searchPath, command);
    if (existsSync(fullPath)) {
      return { 
        command, 
        resolvedPath: fullPath, 
        searchedPaths: searchPaths,
        isDocker
      };
    }
  }
  
  return { 
    command, 
    resolvedPath: null, 
    searchedPaths: searchPaths,
    isDocker
  };
}

import { describe, expect, it } from "vitest";

import { buildClaudeMessageLaunch } from "../sessionAgentRuntime.js";

describe("buildClaudeMessageLaunch", () => {
  it("carries staged launch env and mcp config into per-message Claude spawns", () => {
    const launch = buildClaudeMessageLaunch({
      workingDirectory: "/tmp/project",
      adapterEnv: {
        CLAUDE_WORKING_DIR: "/tmp/project",
      },
      launchEnv: {
        HOME: "/tmp/session-home",
        BOB_CLAUDE_MCP_CONFIG_PATH: "/tmp/bob-mcp-config.json",
        BOB_SECRET_BROKER_TOKEN: "broker-token",
      },
      claudeSessionId: "claude-session-1",
    });

    expect(launch.cwd).toBe("/tmp/project");
    expect(launch.args).toEqual([
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      "--dangerously-skip-permissions",
      "--resume",
      "claude-session-1",
      "--mcp-config",
      "/tmp/bob-mcp-config.json",
    ]);
    expect(launch.env.HOME).toBe("/tmp/session-home");
    expect(launch.env.CLAUDE_WORKING_DIR).toBe("/tmp/project");
    expect(launch.env.BOB_SECRET_BROKER_TOKEN).toBe("broker-token");
  });
});

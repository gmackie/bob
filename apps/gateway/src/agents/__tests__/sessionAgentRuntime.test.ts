import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { prepareSessionAgentRuntime } from "../sessionAgentRuntime.js";

const tempRoots: string[] = [];

async function createTempRoot(prefix: string) {
  const root = await mkdtemp(path.join(tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

describe("prepareSessionAgentRuntime", () => {
  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("stages a Claude home overlay with a Bob skill and MCP config", async () => {
    const runtimeRoot = await createTempRoot("bob-agent-runtime-");
    const hostHomeDir = await createTempRoot("bob-agent-host-home-");
    await mkdir(path.join(hostHomeDir, ".claude", "skills", "existing-skill"), { recursive: true });
    await writeFile(
      path.join(hostHomeDir, ".claude", "skills", "existing-skill", "SKILL.md"),
      "---\nname: existing-skill\ndescription: Existing skill\n---\n",
      "utf8",
    );
    await writeFile(
      path.join(hostHomeDir, ".claude", "settings.json"),
      '{"theme":"dark"}',
      "utf8",
    );

    const runtime = await prepareSessionAgentRuntime({
      agentType: "claude",
      sessionId: "session-123",
      runtimeRoot,
      hostHomeDir,
      runtimeEnv: {
        BOB_API_URL: "https://bob.example.com",
        BOB_API_KEY: "api-key",
        BOB_SESSION_ID: "session-123",
        BOB_SECRET_BROKER_URL: "http://127.0.0.1:3002/session/secrets/execute",
        BOB_SECRET_BROKER_TOKEN: "broker-token",
        BOB_SESSION_SECRET_MANIFEST: '[{"handle":"github-token"}]',
      },
    });

    expect(runtime.env.HOME).toBe(path.join(runtimeRoot, "session-123", "claude-home"));
    expect(runtime.env.BOB_CLAUDE_MCP_CONFIG_PATH).toBeDefined();
    const runtimeHome = runtime.env.HOME;
    if (!runtimeHome) {
      throw new Error("Expected Claude runtime HOME");
    }

    const skillPath = path.join(
      runtimeHome,
      ".claude",
      "skills",
      "bob-workflow",
      "SKILL.md",
    );
    const skillContents = await readFile(skillPath, "utf8");
    expect(skillContents).toContain("name: bob-workflow");
    expect(skillContents).toContain("`mcp__bob__exec_session_secret`");
    expect(skillContents).toContain("`mcp__bob__update_status`");

    const mcpConfigPath = runtime.env.BOB_CLAUDE_MCP_CONFIG_PATH;
    if (!mcpConfigPath) {
      throw new Error("Expected Claude MCP config path");
    }
    const mcpConfig = JSON.parse(await readFile(mcpConfigPath, "utf8")) as {
      mcpServers: {
        bob: {
          env: Record<string, string>;
        };
      };
    };
    expect(mcpConfig.mcpServers.bob.env.BOB_SECRET_BROKER_TOKEN).toBe("broker-token");
    expect(mcpConfig.mcpServers.bob.env.BOB_SESSION_SECRET_MANIFEST).toBe(
      '[{"handle":"github-token"}]',
    );
  });

  it("stages a Codex home overlay with the Bob skill and MCP server config", async () => {
    const runtimeRoot = await createTempRoot("bob-agent-runtime-");
    const hostHomeDir = await createTempRoot("bob-agent-host-home-");
    await mkdir(path.join(hostHomeDir, ".codex", "skills", "existing-skill"), { recursive: true });
    await writeFile(
      path.join(hostHomeDir, ".codex", "skills", "existing-skill", "SKILL.md"),
      "---\nname: existing-skill\ndescription: Existing skill\n---\n",
      "utf8",
    );
    await writeFile(
      path.join(hostHomeDir, ".codex", "config.toml"),
      'personality = "pragmatic"\n',
      "utf8",
    );

    const runtime = await prepareSessionAgentRuntime({
      agentType: "codex",
      sessionId: "session-456",
      runtimeRoot,
      hostHomeDir,
      runtimeEnv: {
        BOB_API_URL: "https://bob.example.com",
        BOB_API_KEY: "api-key",
        BOB_SESSION_ID: "session-456",
        BOB_SECRET_BROKER_URL: "http://127.0.0.1:3002/session/secrets/execute",
        BOB_SECRET_BROKER_TOKEN: "broker-token",
      },
    });

    expect(runtime.env.HOME).toBe(path.join(runtimeRoot, "session-456", "codex-home"));
    const codexHome = runtime.env.HOME;
    if (!codexHome) {
      throw new Error("Expected Codex runtime HOME");
    }

    const skillContents = await readFile(
      path.join(codexHome, ".codex", "skills", "bob-workflow", "SKILL.md"),
      "utf8",
    );
    expect(skillContents).toContain("`mcp__bob__list_session_secrets`");

    const configContents = await readFile(
      path.join(codexHome, ".codex", "config.toml"),
      "utf8",
    );
    expect(configContents).toContain('personality = "pragmatic"');
    expect(configContents).toContain("[mcp_servers.bob]");
    expect(configContents).toContain('BOB_SECRET_BROKER_URL = "http://127.0.0.1:3002/session/secrets/execute"');
  });

  it("stages an OpenCode config overlay with the Bob skill and MCP entry", async () => {
    const runtimeRoot = await createTempRoot("bob-agent-runtime-");
    const hostOpencodeConfigDir = await createTempRoot("bob-agent-host-opencode-");
    await mkdir(path.join(hostOpencodeConfigDir, "skills", "existing-skill"), { recursive: true });
    await writeFile(
      path.join(hostOpencodeConfigDir, "skills", "existing-skill", "SKILL.md"),
      "---\nname: existing-skill\ndescription: Existing skill\n---\n",
      "utf8",
    );
    await writeFile(
      path.join(hostOpencodeConfigDir, "opencode.json"),
      JSON.stringify({ plugin: ["oh-my-opencode"], mcp: {} }, null, 2),
      "utf8",
    );

    const runtime = await prepareSessionAgentRuntime({
      agentType: "opencode",
      sessionId: "session-789",
      runtimeRoot,
      hostOpencodeConfigDir,
      runtimeEnv: {
        BOB_API_URL: "https://bob.example.com",
        BOB_API_KEY: "api-key",
        BOB_SESSION_ID: "session-789",
        BOB_SECRET_BROKER_URL: "http://127.0.0.1:3002/session/secrets/execute",
        BOB_SECRET_BROKER_TOKEN: "broker-token",
      },
    });

    expect(runtime.env.OPENCODE_CONFIG_DIR).toBe(
      path.join(runtimeRoot, "session-789", "opencode-config"),
    );
    const opencodeConfigDir = runtime.env.OPENCODE_CONFIG_DIR;
    if (!opencodeConfigDir) {
      throw new Error("Expected OpenCode config dir");
    }

    const skillContents = await readFile(
      path.join(opencodeConfigDir, "skills", "bob-workflow", "SKILL.md"),
      "utf8",
    );
    expect(skillContents).toContain("`mcp__bob__exec_session_secret`");

    const config = JSON.parse(
      await readFile(path.join(opencodeConfigDir, "opencode.json"), "utf8"),
    ) as {
      plugin: string[];
      mcp: Record<string, { command: string[]; environment?: Record<string, string> }>;
    };
    expect(config.plugin).toContain("oh-my-opencode");
    expect(config.mcp.bob?.command).toEqual(["npx", "@bob/mcp-server"]);
    expect(config.mcp.bob?.environment?.BOB_SECRET_BROKER_TOKEN).toBe("broker-token");
  });
});

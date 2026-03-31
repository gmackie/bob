import { mkdir, readdir, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Dirent } from "node:fs";

import { bobWorkflowSkill, getMcpServerConfig } from "@bob/agent-toolkit";

const BOB_MCP_SERVER_NAME = "bob";
const BOB_MCP_TOOL_PREFIX = `mcp__${BOB_MCP_SERVER_NAME}__`;

interface PrepareSessionAgentRuntimeInput {
  agentType: string;
  sessionId: string;
  runtimeEnv?: Record<string, string | undefined>;
  runtimeRoot?: string;
  hostHomeDir?: string;
  hostOpencodeConfigDir?: string;
}

interface SessionAgentRuntime {
  env: Record<string, string>;
}

interface ClaudeMessageLaunchInput {
  workingDirectory?: string;
  adapterEnv?: Record<string, string | undefined>;
  launchEnv?: Record<string, string | undefined>;
  claudeSessionId?: string;
}

interface ClaudeMessageLaunch {
  args: string[];
  cwd: string;
  env: Record<string, string>;
}

function toStringRecord(
  value: Record<string, string | undefined> | undefined,
): Record<string, string> {
  if (!value) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] =>
        typeof entry[0] === "string" && typeof entry[1] === "string",
    ),
  );
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function renderBobWorkflowSkillMarkdown(toolPrefix: string) {
  const toolNames = [...(bobWorkflowSkill.allowedTools ?? [])].sort(
    (left, right) => right.length - left.length,
  );

  let template = bobWorkflowSkill.template;
  for (const toolName of toolNames) {
    template = template.replace(
      new RegExp(`\\b${escapeRegExp(toolName)}\\b`, "g"),
      `${toolPrefix}${toolName}`,
    );
  }

  return `---\nname: ${bobWorkflowSkill.name}\ndescription: ${bobWorkflowSkill.description}\n---\n\n${template}\n`;
}

function buildBobMcpEnv(
  sessionId: string,
  runtimeEnv: Record<string, string | undefined> | undefined,
) {
  const merged = {
    ...(process.env.BOB_API_URL ? { BOB_API_URL: process.env.BOB_API_URL } : {}),
    ...(process.env.BOB_API_KEY ? { BOB_API_KEY: process.env.BOB_API_KEY } : {}),
    ...(runtimeEnv ?? {}),
    BOB_SESSION_ID: runtimeEnv?.BOB_SESSION_ID ?? sessionId,
  };

  return toStringRecord(merged);
}

async function symlinkDirectoryEntries(
  sourceDir: string,
  targetDir: string,
  options?: {
    skip?: string[];
  },
) {
  const skip = new Set(options?.skip ?? []);
  await mkdir(targetDir, { recursive: true });

  let entries: Dirent[];
  try {
    entries = await readdir(sourceDir, {
      withFileTypes: true,
      encoding: "utf8",
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return;
    }

    throw error;
  }

  await Promise.all(
    entries.map(async (entry) => {
      if (skip.has(entry.name)) {
        return;
      }

      await symlink(
        path.join(sourceDir, entry.name),
        path.join(targetDir, entry.name),
      );
    }),
  );
}

async function writeBobSkillFile(skillsDir: string) {
  const bobSkillDir = path.join(skillsDir, bobWorkflowSkill.name);
  await mkdir(bobSkillDir, { recursive: true });
  await writeFile(
    path.join(bobSkillDir, "SKILL.md"),
    renderBobWorkflowSkillMarkdown(BOB_MCP_TOOL_PREFIX),
    "utf8",
  );
}

function buildCodexMcpConfigToml(bobEnv: Record<string, string>) {
  const envEntries = Object.entries(bobEnv)
    .map(([key, value]) => `${key} = ${JSON.stringify(value)}`)
    .join("\n");

  return [
    "[mcp_servers.bob]",
    'command = "npx"',
    'args = ["@bob/mcp-server"]',
    "",
    "[mcp_servers.bob.env]",
    envEntries,
    "",
  ].join("\n");
}

async function prepareClaudeRuntime(
  input: PrepareSessionAgentRuntimeInput,
  bobEnv: Record<string, string>,
) {
  const hostHomeDir = input.hostHomeDir ?? process.env.HOME ?? "";
  const sessionRoot = path.join(
    input.runtimeRoot ?? path.join(tmpdir(), "bob-agent-runtime"),
    input.sessionId,
  );
  const runtimeHome = path.join(sessionRoot, "claude-home");
  const runtimeClaudeDir = path.join(runtimeHome, ".claude");
  const hostClaudeDir = path.join(hostHomeDir, ".claude");
  const skillsDir = path.join(runtimeClaudeDir, "skills");
  const mcpConfigPath = path.join(runtimeClaudeDir, "mcp-config.json");

  await symlinkDirectoryEntries(hostClaudeDir, runtimeClaudeDir, {
    skip: ["skills"],
  });
  await symlinkDirectoryEntries(path.join(hostClaudeDir, "skills"), skillsDir, {
    skip: [bobWorkflowSkill.name],
  });
  await writeBobSkillFile(skillsDir);
  await writeFile(
    mcpConfigPath,
    JSON.stringify(
      {
        mcpServers: {
          [BOB_MCP_SERVER_NAME]: getMcpServerConfig({
            apiUrl: bobEnv.BOB_API_URL ?? "http://localhost:3000",
            apiKey: bobEnv.BOB_API_KEY ?? "",
            sessionId: bobEnv.BOB_SESSION_ID,
            secretBrokerUrl: bobEnv.BOB_SECRET_BROKER_URL,
            secretBrokerToken: bobEnv.BOB_SECRET_BROKER_TOKEN,
            sessionSecretManifest: bobEnv.BOB_SESSION_SECRET_MANIFEST,
          }),
        },
      },
      null,
      2,
    ),
    "utf8",
  );

  return {
    env: {
      HOME: runtimeHome,
      BOB_CLAUDE_MCP_CONFIG_PATH: mcpConfigPath,
    },
  } satisfies SessionAgentRuntime;
}

async function prepareCodexRuntime(
  input: PrepareSessionAgentRuntimeInput,
  bobEnv: Record<string, string>,
) {
  const hostHomeDir = input.hostHomeDir ?? process.env.HOME ?? "";
  const sessionRoot = path.join(
    input.runtimeRoot ?? path.join(tmpdir(), "bob-agent-runtime"),
    input.sessionId,
  );
  const runtimeHome = path.join(sessionRoot, "codex-home");
  const runtimeCodexDir = path.join(runtimeHome, ".codex");
  const hostCodexDir = path.join(hostHomeDir, ".codex");
  const skillsDir = path.join(runtimeCodexDir, "skills");
  const hostConfigPath = path.join(hostCodexDir, "config.toml");
  const runtimeConfigPath = path.join(runtimeCodexDir, "config.toml");

  await symlinkDirectoryEntries(hostCodexDir, runtimeCodexDir, {
    skip: ["skills", "config.toml"],
  });
  await symlinkDirectoryEntries(path.join(hostCodexDir, "skills"), skillsDir, {
    skip: [bobWorkflowSkill.name],
  });
  await writeBobSkillFile(skillsDir);

  let existingConfig = "";
  try {
    existingConfig = await readFile(hostConfigPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  const trimmedConfig = existingConfig.trimEnd();
  const bobConfigBlock = buildCodexMcpConfigToml(bobEnv);
  await writeFile(
    runtimeConfigPath,
    `${trimmedConfig}${trimmedConfig ? "\n\n" : ""}${bobConfigBlock}`,
    "utf8",
  );

  return {
    env: {
      HOME: runtimeHome,
    },
  } satisfies SessionAgentRuntime;
}

async function prepareOpenCodeRuntime(
  input: PrepareSessionAgentRuntimeInput,
  bobEnv: Record<string, string>,
) {
  const hostHomeDir = input.hostHomeDir ?? process.env.HOME ?? "";
  const xdgConfigHome =
    process.env.XDG_CONFIG_HOME ?? path.join(hostHomeDir, ".config");
  const hostConfigDir =
    input.hostOpencodeConfigDir ??
    process.env.OPENCODE_CONFIG_DIR ??
    path.join(xdgConfigHome, "opencode");
  const sessionRoot = path.join(
    input.runtimeRoot ?? path.join(tmpdir(), "bob-agent-runtime"),
    input.sessionId,
  );
  const runtimeConfigDir = path.join(sessionRoot, "opencode-config");
  const skillsDir = path.join(runtimeConfigDir, "skills");
  const configPath = path.join(runtimeConfigDir, "opencode.json");

  await symlinkDirectoryEntries(hostConfigDir, runtimeConfigDir, {
    skip: ["skills", "opencode.json"],
  });
  await symlinkDirectoryEntries(path.join(hostConfigDir, "skills"), skillsDir, {
    skip: [bobWorkflowSkill.name],
  });
  await writeBobSkillFile(skillsDir);

  let existingConfig: Record<string, unknown> = {};
  try {
    existingConfig = JSON.parse(await readFile(path.join(hostConfigDir, "opencode.json"), "utf8")) as Record<string, unknown>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  const currentMcp =
    existingConfig.mcp && typeof existingConfig.mcp === "object"
      ? (existingConfig.mcp as Record<string, unknown>)
      : {};

  const mergedConfig = {
    ...existingConfig,
    mcp: {
      ...currentMcp,
      [BOB_MCP_SERVER_NAME]: {
        type: "local",
        command: ["npx", "@bob/mcp-server"],
        environment: bobEnv,
        enabled: true,
      },
    },
  };

  await writeFile(configPath, JSON.stringify(mergedConfig, null, 2), "utf8");

  return {
    env: {
      OPENCODE_CONFIG_DIR: runtimeConfigDir,
    },
  } satisfies SessionAgentRuntime;
}

export async function prepareSessionAgentRuntime(
  input: PrepareSessionAgentRuntimeInput,
): Promise<SessionAgentRuntime> {
  const bobEnv = buildBobMcpEnv(input.sessionId, input.runtimeEnv);

  switch (input.agentType) {
    case "claude":
      return await prepareClaudeRuntime(input, bobEnv);
    case "codex":
      return await prepareCodexRuntime(input, bobEnv);
    case "opencode":
      return await prepareOpenCodeRuntime(input, bobEnv);
    default:
      return { env: {} };
  }
}

export function buildClaudeMessageLaunch(
  input: ClaudeMessageLaunchInput,
): ClaudeMessageLaunch {
  const adapterEnv = toStringRecord(input.adapterEnv);
  const launchEnv = toStringRecord(input.launchEnv);
  const cwd =
    input.workingDirectory && input.workingDirectory !== "/"
      ? input.workingDirectory
      : launchEnv.HOME ?? process.env.HOME ?? "/";

  const args = [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--dangerously-skip-permissions",
  ];

  if (input.claudeSessionId) {
    args.push("--resume", input.claudeSessionId);
  }

  if (launchEnv.BOB_CLAUDE_MCP_CONFIG_PATH) {
    args.push("--mcp-config", launchEnv.BOB_CLAUDE_MCP_CONFIG_PATH);
  }

  return {
    args,
    cwd,
    env: {
      ...process.env,
      ...launchEnv,
      ...adapterEnv,
    } as Record<string, string>,
  };
}

export { bobWorkflowSkill } from "./bob-workflow-skill.js";
export type { BuiltinSkill } from "./bob-workflow-skill.js";

export function getOhMyOpenCodeMcpConfig(env: {
  apiUrl: string;
  apiKey: string;
  sessionId?: string;
}) {
  return {
    bob: {
      command: "npx",
      args: ["@bob/mcp-server"],
      env: {
        BOB_API_URL: env.apiUrl,
        BOB_API_KEY: env.apiKey,
        ...(env.sessionId ? { BOB_SESSION_ID: env.sessionId } : {}),
      },
    },
  };
}

export function generateOhMyOpenCodeConfig(env: {
  apiUrl: string;
  apiKey: string;
  sessionId?: string;
}) {
  return {
    mcpServers: getOhMyOpenCodeMcpConfig(env),
    skills: {
      "bob-workflow": {
        name: "bob-workflow",
        description: "Workflow and status reporting for Bob-managed sessions",
        source: "@bob/agent-toolkit/oh-my-opencode/bob-workflow-skill",
      },
    },
  };
}

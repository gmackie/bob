export { bobWorkflowSkill } from "./bob-workflow-skill.js";
export { createGmackoAppFeatureDevelopmentSkill } from "./create-gmacko-app-feature-development-skill.js";
export { storybookDevelopmentSkill } from "./storybook-development-skill.js";
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
      "storybook-development": {
        name: "storybook-development",
        description:
          "State-first Storybook workflow for UI generation, state coverage, and prompt-driven iteration",
        source:
          "@bob/agent-toolkit/oh-my-opencode/storybook-development-skill",
      },
      "create-gmacko-app-feature-development": {
        name: "create-gmacko-app-feature-development",
        description:
          "Feature placement guidance for create-gmacko-app repos so agents know where code belongs across apps/nextjs, packages/ui, packages/api, packages/db, helpers, and shared packages.",
        source:
          "@bob/agent-toolkit/oh-my-opencode/create-gmacko-app-feature-development-skill",
      },
    },
  };
}

export const SKILL_NAMES = [
  "bob-workflow",
  "storybook-development",
  "create-gmacko-app-feature-development",
  "work-item-shaping",
  "work-item-breakdown",
] as const;

export type SkillName = (typeof SKILL_NAMES)[number];

export const CONFIG_NAMES = ["mcp-config", "opencode-config"] as const;

export type ConfigName = (typeof CONFIG_NAMES)[number];

export const PROMPT_NAMES = [
  "storybook-task-template",
  "storybook-prompt-library",
] as const;

export type PromptName = (typeof PROMPT_NAMES)[number];

export interface BobAgentConfig {
  apiUrl: string;
  apiKey: string;
  sessionId?: string;
}

export function getMcpServerConfig(config: BobAgentConfig) {
  return {
    command: "npx",
    args: ["@bob/mcp-server"],
    env: {
      BOB_API_URL: config.apiUrl,
      BOB_API_KEY: config.apiKey,
      ...(config.sessionId ? { BOB_SESSION_ID: config.sessionId } : {}),
    },
  };
}

export {
  bobWorkflowSkill,
  createGmackoAppFeatureDevelopmentSkill,
  getOhMyOpenCodeMcpConfig,
  generateOhMyOpenCodeConfig,
  storybookDevelopmentSkill,
  workItemBreakdownSkill,
  workItemShapingSkill,
} from "./oh-my-opencode/index.js";
export type { BuiltinSkill } from "./oh-my-opencode/index.js";

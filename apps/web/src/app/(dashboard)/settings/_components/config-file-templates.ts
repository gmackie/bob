import {
  bobWorkflowSkill,
  createGmackoAppFeatureDevelopmentSkill,
  storybookDevelopmentSkill,
  workItemBreakdownSkill,
  workItemShapingSkill,
} from "@bob/agent-toolkit/oh-my-opencode";

const bobMcpServer = bobWorkflowSkill.mcpConfig?.mcpServers.bob;

const starterSkills = [
  bobWorkflowSkill,
  storybookDevelopmentSkill,
  createGmackoAppFeatureDevelopmentSkill,
  workItemShapingSkill,
  workItemBreakdownSkill,
];

export const OPENCODE_JSON_TEMPLATE =
  "{\n" +
  '  "$schema": "https://opencode.ai/config.json",\n' +
  '  "model": "anthropic/claude-opus-4-5",\n' +
  '  "small_model": "anthropic/claude-haiku-4-5",\n' +
  '  "autoupdate": false\n' +
  "}\n";

export const OPENCODE_CONFIG_JSON_TEMPLATE =
  JSON.stringify(
    {
      $schema: "https://opencode.ai/schemas/config.json",
      mcpServers: {
        bob: {
          type: "stdio",
          command: bobMcpServer?.command ?? "npx",
          args: bobMcpServer?.args ?? ["@bob/mcp-server"],
          env: bobMcpServer?.env ?? {},
        },
      },
      skills: starterSkills.map((skill) => ({
        name: skill.name,
        description: skill.description,
        path: `./skills/${skill.name}.md`,
      })),
    },
    null,
    2,
  ) + "\n";

export const BOB_WORKFLOW_SKILL_TEMPLATE = `${bobWorkflowSkill.template}\n`;
export const STORYBOOK_DEVELOPMENT_SKILL_TEMPLATE =
  `${storybookDevelopmentSkill.template}\n`;
export const CREATE_GMACKO_APP_FEATURE_DEVELOPMENT_SKILL_TEMPLATE =
  `${createGmackoAppFeatureDevelopmentSkill.template}\n`;
export const WORK_ITEM_SHAPING_SKILL_TEMPLATE =
  `${workItemShapingSkill.template}\n`;
export const WORK_ITEM_BREAKDOWN_SKILL_TEMPLATE =
  `${workItemBreakdownSkill.template}\n`;

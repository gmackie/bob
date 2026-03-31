import assert from "node:assert/strict";
import test from "node:test";

import { SKILL_NAMES, getMcpServerConfig } from "../index.js";
import {
  bobWorkflowSkill,
  generateOhMyOpenCodeConfig,
  getOhMyOpenCodeMcpConfig,
} from "../oh-my-opencode/index.js";
import {
  createGmackoAppFeatureDevelopmentSkill,
  workItemBreakdownSkill,
  workItemShapingSkill,
} from "../oh-my-opencode/index.js";

test("exports the storybook development skill in the public registry", () => {
  assert.ok(
    SKILL_NAMES.includes("storybook-development"),
    "Expected storybook-development to be listed in SKILL_NAMES",
  );
});

test("includes the storybook development skill in generated Oh My OpenCode config", () => {
  const config = generateOhMyOpenCodeConfig({
    apiUrl: "https://bob.example.com",
    apiKey: "test-key",
    sessionId: "session-123",
  });

  assert.ok(config.skills["storybook-development"]);
  assert.equal(
    config.skills["storybook-development"].source,
    "@bob/agent-toolkit/oh-my-opencode/storybook-development-skill",
  );
});

test("advertises session secret tools through the Bob workflow skill", () => {
  assert.ok(
    bobWorkflowSkill.allowedTools?.includes("list_session_secrets"),
    "Expected Bob workflow skill to allow listing session secrets",
  );
  assert.ok(
    bobWorkflowSkill.allowedTools?.includes("exec_session_secret"),
    "Expected Bob workflow skill to allow executing session secret templates",
  );
  assert.match(
    bobWorkflowSkill.template,
    /list_session_secrets/,
    "Expected Bob workflow skill instructions to mention secret discovery",
  );
  assert.match(
    bobWorkflowSkill.template,
    /exec_session_secret/,
    "Expected Bob workflow skill instructions to mention secret execution",
  );
});

test("includes session secret broker env in Bob workflow MCP config", () => {
  const bobEnv = bobWorkflowSkill.mcpConfig?.mcpServers.bob?.env;
  assert.ok(bobEnv, "Expected Bob workflow skill to define MCP env");
  assert.deepEqual(bobEnv, {
    BOB_API_URL: "${env:BOB_API_URL}",
    BOB_API_KEY: "${env:BOB_API_KEY}",
    BOB_SESSION_ID: "${env:BOB_SESSION_ID}",
    BOB_SECRET_BROKER_URL: "${env:BOB_SECRET_BROKER_URL}",
    BOB_SECRET_BROKER_TOKEN: "${env:BOB_SECRET_BROKER_TOKEN}",
    BOB_SESSION_SECRET_MANIFEST: "${env:BOB_SESSION_SECRET_MANIFEST}",
  });
});

test("includes session secret broker env in generated MCP config helpers", () => {
  const input = {
    apiUrl: "https://bob.example.com",
    apiKey: "test-key",
    sessionId: "session-123",
    secretBrokerUrl: "http://127.0.0.1:4321/session-secret",
    secretBrokerToken: "secret-broker-token",
    sessionSecretManifest: '[{"handle":"npm-token","label":"npm-token"}]',
  };

  assert.deepEqual(getOhMyOpenCodeMcpConfig(input).bob.env, {
    BOB_API_URL: "https://bob.example.com",
    BOB_API_KEY: "test-key",
    BOB_SESSION_ID: "session-123",
    BOB_SECRET_BROKER_URL: "http://127.0.0.1:4321/session-secret",
    BOB_SECRET_BROKER_TOKEN: "secret-broker-token",
    BOB_SESSION_SECRET_MANIFEST:
      '[{"handle":"npm-token","label":"npm-token"}]',
  });

  assert.deepEqual(getMcpServerConfig(input).env, {
    BOB_API_URL: "https://bob.example.com",
    BOB_API_KEY: "test-key",
    BOB_SESSION_ID: "session-123",
    BOB_SECRET_BROKER_URL: "http://127.0.0.1:4321/session-secret",
    BOB_SECRET_BROKER_TOKEN: "secret-broker-token",
    BOB_SESSION_SECRET_MANIFEST:
      '[{"handle":"npm-token","label":"npm-token"}]',
  });
});

test("exports the create-gmacko-app feature development skill in the public registry", () => {
  assert.ok(
    SKILL_NAMES.includes("create-gmacko-app-feature-development"),
    "Expected create-gmacko-app-feature-development to be listed in SKILL_NAMES",
  );
});

test("includes the create-gmacko-app feature development skill in generated Oh My OpenCode config", () => {
  const config = generateOhMyOpenCodeConfig({
    apiUrl: "https://bob.example.com",
    apiKey: "test-key",
    sessionId: "session-123",
  });

  assert.ok(config.skills["create-gmacko-app-feature-development"]);
  assert.equal(
    config.skills["create-gmacko-app-feature-development"].source,
    "@bob/agent-toolkit/oh-my-opencode/create-gmacko-app-feature-development-skill",
  );
});

test("describes Playwright, browser QA, and Maestro in the create-gmacko-app feature development skill", () => {
  assert.match(createGmackoAppFeatureDevelopmentSkill.template, /Playwright/);
  assert.match(createGmackoAppFeatureDevelopmentSkill.template, /\/browse/);
  assert.match(createGmackoAppFeatureDevelopmentSkill.template, /Maestro/);
});

test("exports the work-item shaping and breakdown skills in the public registry", () => {
  assert.ok(
    SKILL_NAMES.includes("work-item-shaping"),
    "Expected work-item-shaping to be listed in SKILL_NAMES",
  );
  assert.ok(
    SKILL_NAMES.includes("work-item-breakdown"),
    "Expected work-item-breakdown to be listed in SKILL_NAMES",
  );
});

test("includes the work-item shaping and breakdown skills in generated Oh My OpenCode config", () => {
  const config = generateOhMyOpenCodeConfig({
    apiUrl: "https://bob.example.com",
    apiKey: "test-key",
    sessionId: "session-123",
  });

  assert.ok(config.skills["work-item-shaping"]);
  assert.equal(
    config.skills["work-item-shaping"].source,
    "@bob/agent-toolkit/oh-my-opencode/work-item-shaping-skill",
  );
  assert.ok(config.skills["work-item-breakdown"]);
  assert.equal(
    config.skills["work-item-breakdown"].source,
    "@bob/agent-toolkit/oh-my-opencode/work-item-breakdown-skill",
  );
});

test("describes epic shaping, BRD creation, requirement linking, and lifecycle progression in the work-item skills", () => {
  assert.match(workItemShapingSkill.template, /epic/i);
  assert.match(workItemShapingSkill.template, /BRD|business requirements/i);
  assert.match(workItemShapingSkill.template, /one question at a time/i);

  assert.match(workItemBreakdownSkill.template, /requirements/i);
  assert.match(workItemBreakdownSkill.template, /linkedTaskId|link requirements to tasks/i);
  assert.match(workItemBreakdownSkill.template, /parent issue or epic|child tasks/i);
  assert.match(workItemBreakdownSkill.template, /shape|plan|execute|review|ship/i);
});

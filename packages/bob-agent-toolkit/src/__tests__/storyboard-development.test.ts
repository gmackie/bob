import assert from "node:assert/strict";
import test from "node:test";

import { SKILL_NAMES } from "../index.js";
import { generateOhMyOpenCodeConfig } from "../oh-my-opencode/index.js";
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

import assert from "node:assert/strict";
import test from "node:test";

import { SKILL_NAMES } from "../index.js";
import { generateOhMyOpenCodeConfig } from "../oh-my-opencode/index.js";
import { createGmackoAppFeatureDevelopmentSkill } from "../oh-my-opencode/index.js";

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

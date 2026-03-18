import assert from "node:assert/strict";
import test from "node:test";

import { SKILL_NAMES } from "../index.js";
import { generateOhMyOpenCodeConfig } from "../oh-my-opencode/index.js";

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

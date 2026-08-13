import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const wrangler = readFileSync(
  resolve(repositoryRoot, "apps/ooda-edge/wrangler.jsonc"),
  "utf8",
);
const workflow = readFileSync(
  resolve(repositoryRoot, ".forgejo/workflows/ci.yml"),
  "utf8",
);

function assertSafeRolloutConfig(config) {
  const stage = config.match(/"OODA_ROLLOUT_STAGE": "([^"]+)"/)?.[1];
  const killSwitch = config.match(
    /"OODA_ROLLOUT_KILL_SWITCH": "([^"]+)"/,
  )?.[1];

  assert.ok(
    [
      "shadow",
      "conversations",
      "mobile_text",
      "tts",
      "jobs",
      "obsidian",
      "durable_work",
    ].includes(stage),
    `unsafe OODA rollout stage: ${stage}`,
  );
  assert.ok(
    killSwitch === "true" || killSwitch === "false",
    `invalid OODA rollout kill switch: ${killSwitch}`,
  );
}

test("production never advances beyond the durable-work capability", () => {
  assertSafeRolloutConfig(wrangler);
});

test("the contract permits a fail-closed stage or kill-switch rollback", () => {
  assert.doesNotThrow(() =>
    assertSafeRolloutConfig(
      wrangler
        .replace(
          '"OODA_ROLLOUT_STAGE": "durable_work"',
          '"OODA_ROLLOUT_STAGE": "jobs"',
        )
        .replace(
          '"OODA_ROLLOUT_KILL_SWITCH": "false"',
          '"OODA_ROLLOUT_KILL_SWITCH": "true"',
        ),
    ),
  );
});

test("production keeps portfolio and specialist adapters behind later stages", () => {
  assert.doesNotMatch(
    wrangler,
    /"OODA_ROLLOUT_STAGE": "(?:portfolio_evidence|specialists|reviews_push)"/,
  );
});

test("CI enforces the production durable-work rollout contract", () => {
  assert.match(workflow, /name: Validate OODA durable-work rollout/);
  assert.match(
    workflow,
    /node --test scripts\/verify-ooda-durable-work-rollout\.test\.mjs/,
  );
});

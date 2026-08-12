import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workflow = readFileSync(
  resolve(repositoryRoot, ".forgejo/workflows/preflight-build.yml"),
  "utf8",
);

test("Preflight builds attach to Bob's canonical app record", () => {
  assert.match(workflow, /^\s*APP_ID:\s*pfapp_bob\s*$/m);
  assert.doesNotMatch(workflow, /APP_ID:\s*pfapp_bob_mobile/);
  assert.match(
    workflow,
    /APP_EAS_PROJECT_ID:\s*e1dd0ab0-4dc1-40f8-b066-7cb91fde1759/,
  );
});

test("the enqueue fails if Preflight returns a different app identity", () => {
  assert.match(workflow, /jq -r '\.data\.workflow\.appId \/\/ empty'/);
  assert.match(workflow, /QUEUED_APP_ID.*!=.*APP_ID/);
  assert.match(workflow, /Preflight queued app.*expected/);
});

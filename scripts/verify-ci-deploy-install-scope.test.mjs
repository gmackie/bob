import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workflow = readFileSync(
  resolve(repositoryRoot, ".forgejo/workflows/ci.yml"),
  "utf8",
);
const oodaWrangler = readFileSync(
  resolve(repositoryRoot, "apps/ooda-edge/wrangler.jsonc"),
  "utf8",
);

function jobSection(start, end) {
  const startIndex = workflow.indexOf(start);
  const endIndex = end
    ? workflow.indexOf(end, startIndex + start.length)
    : workflow.length;
  assert.notEqual(startIndex, -1, `missing workflow job: ${start.trim()}`);
  if (end) {
    assert.notEqual(endIndex, -1, `missing workflow boundary: ${end.trim()}`);
  }
  return workflow.slice(startIndex, endIndex);
}

test("deploy jobs skip unrelated Electron binary downloads", () => {
  const bobDeploy = jobSection("\n  deploy:\n", "\n  # OODA is promoted");
  const oodaDeploy = jobSection("\n  deploy-ooda-edge:\n");

  for (const deployJob of [bobDeploy, oodaDeploy]) {
    assert.match(
      deployJob,
      /ELECTRON_SKIP_BINARY_DOWNLOAD=1 pnpm install --frozen-lockfile/,
      "deploy jobs must not fetch unrelated desktop binaries",
    );
  }
});

test("the primary CI install skips the Electron runtime download", () => {
  const ciJob = jobSection("\n  ci:\n", "\n  deploy:\n");

  assert.match(
    ciJob,
    /ELECTRON_SKIP_BINARY_DOWNLOAD=1 pnpm install --frozen-lockfile/,
    "CI compiles and tests desktop source without launching Electron",
  );
});

test("the full CI job enforces the deploy install-scope regression test", () => {
  assert.match(workflow, /name: Validate deploy install scope/);
  assert.match(
    workflow,
    /node --test scripts\/verify-ci-deploy-install-scope\.test\.mjs/,
  );
});

test("OODA deploys with bounded ForgeGraph context configuration", () => {
  const oodaDeploy = jobSection("\n  deploy-ooda-edge:\n");

  assert.match(
    oodaWrangler,
    /"FORGEGRAPH_API_URL": "https:\/\/forgegraf\.com"/,
  );
  assert.match(
    oodaWrangler,
    /"FORGEGRAPH_CONTEXT_APPS": "ooda,bob,bizpulse,kanbanger"/,
  );
  assert.match(
    oodaDeploy,
    /FORGEGRAPH_API_KEY: \$\{\{ secrets\.FORGEGRAPH_API_KEY \}\}/,
  );
  assert.match(
    oodaDeploy,
    /wrangler secret put FORGEGRAPH_API_KEY --name ooda-blder-bot/,
  );
});

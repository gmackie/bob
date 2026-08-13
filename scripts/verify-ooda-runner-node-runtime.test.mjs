import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const deployScript = readFileSync(
  resolve(repositoryRoot, "apps/ooda-runner/deploy-hetzner-bob.sh"),
  "utf8",
);
const workflow = readFileSync(
  resolve(repositoryRoot, ".forgejo/workflows/ci.yml"),
  "utf8",
);

test("the Hetzner runner deploy installs the checked-in Node 24 systemd override", () => {
  assert.match(
    deployScript,
    /ooda-runner-node24\.conf.*\/etc\/systemd\/system\/ooda-runner\.service\.d\/20-node24\.conf/s,
  );
  assert.match(deployScript, /systemctl daemon-reload/);
});

test("the Hetzner runner deploy refuses unsupported build and service runtimes", () => {
  assert.match(
    deployScript,
    /require_node_24 "deploy toolchain" "node"/,
  );
  assert.match(
    deployScript,
    /require_node_24 "active service" "\/proc\/\$\{main_pid\}\/exe"/,
  );
});

test("CI enforces the OODA runner Node runtime deployment contract", () => {
  assert.match(workflow, /name: Validate OODA runner Node runtime/);
  assert.match(
    workflow,
    /node --test scripts\/verify-ooda-runner-node-runtime\.test\.mjs/,
  );
});

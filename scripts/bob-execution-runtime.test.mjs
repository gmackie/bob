import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const service = readFileSync(
  resolve(root, "apps/bob-execution/bob-execution.service"),
  "utf8",
);
const serviceNode = /^ExecStart=(\S+)/m.exec(service)?.[1];

test("execution service uses the provisioned Bob Node runtime", () => {
  assert.equal(serviceNode, "/home/bob/.local/bin/node");
});

for (const version of ["20.19.6", "24.16.0"]) {
  test(`deploy preflight checks Node ${version} as the service user before mutations`, () => {
    const fixture = mkdtempSync(resolve(tmpdir(), "bob-service-runtime-"));
    const trace = resolve(fixture, "trace.jsonl");
    try {
      writeFileSync(
        resolve(fixture, "ssh"),
        `#!${process.execPath}
const fs = require("node:fs");
const vm = require("node:vm");
fs.appendFileSync(process.env.RUNTIME_TRACE, JSON.stringify(process.argv.slice(2)) + "\\n");
vm.runInNewContext(fs.readFileSync(0, "utf8"), {
  process: { versions: { node: process.env.RUNTIME_VERSION }, exit: process.exit },
  require,
});
`,
        { mode: 0o755 },
      );
      writeFileSync(
        resolve(fixture, "pnpm"),
        '#!/bin/sh\nprintf "pnpm\\n" >> "$RUNTIME_TRACE"\nexit 73\n',
        { mode: 0o755 },
      );
      const result = spawnSync(
        "bash",
        [
          resolve(root, "apps/bob-execution/deploy-hetzner-bob.sh"),
          "fixture",
          "root",
        ],
        {
          env: {
            ...process.env,
            PATH: `${fixture}:${process.env.PATH}`,
            RUNTIME_TRACE: trace,
            RUNTIME_VERSION: version,
          },
          encoding: "utf8",
          timeout: 15000,
        },
      );
      const lines = readFileSync(trace, "utf8").trim().split("\n");
      assert.deepEqual(JSON.parse(lines[0]), [
        "root@fixture",
        "/usr/sbin/runuser",
        "-u",
        "bob",
        "--",
        serviceNode,
      ]);
      if (version.startsWith("20.")) {
        assert.equal(result.status, 1, result.stderr);
        assert.equal(
          lines.length,
          1,
          "unsupported runtime must stop before build or remote file changes",
        );
      } else {
        assert.equal(result.status, 73, result.stderr);
        assert.deepEqual(
          lines.slice(1),
          ["pnpm"],
          "supported runtime reaches local build before remote changes",
        );
      }
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });
}

test("standalone runtime lock agrees with the declared manifest and pins registry artifacts", () => {
  const manifest = JSON.parse(
    readFileSync(
      resolve(root, "apps/bob-execution/daemon-runtime-package.json"),
      "utf8",
    ),
  );
  const lock = JSON.parse(
    readFileSync(
      resolve(root, "apps/bob-execution/daemon-runtime-package-lock.json"),
      "utf8",
    ),
  );
  assert.equal(lock.lockfileVersion, 3);
  assert.equal(lock.name, manifest.name);
  assert.deepEqual(lock.packages[""].dependencies, manifest.dependencies);
  assert.deepEqual(lock.packages[""].engines, manifest.engines);
  for (const [path, entry] of Object.entries(lock.packages)) {
    if (!path) continue;
    assert.match(entry.resolved, /^https:\/\/registry\.npmjs\.org\//, path);
    assert.match(entry.integrity, /^sha512-/, path);
    assert.equal(
      entry.link,
      undefined,
      `${path} must not depend on workspace links`,
    );
  }
});

test("deploy stages and transfers the exact standalone lock after runtime preflight", () => {
  const deploy = readFileSync(
    resolve(root, "apps/bob-execution/deploy-hetzner-bob.sh"),
    "utf8",
  );
  const preflight = deploy.indexOf(
    "/usr/sbin/runuser -u bob -- /home/bob/.local/bin/node",
  );
  const lockCopy = deploy.indexOf(
    'cp "${SCRIPT_DIR}/daemon-runtime-package-lock.json" "${DEPLOY_STAGE}/package-lock.json"',
  );
  const install = deploy.indexOf("npm ci --omit=dev --ignore-scripts");
  const transfer = deploy.indexOf('"${DEPLOY_STAGE}/package-lock.json" \\\n');
  assert.ok(
    preflight >= 0 &&
      lockCopy > preflight &&
      install > lockCopy &&
      transfer > install,
  );
  assert.doesNotMatch(deploy, /npm install/);
});

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * GMA-775: right after `wrangler deploy`, Cloudflare can still report the
 * previous Worker version as serving. The report must wait for this commit's
 * version instead of recording a correct deploy as failed, and still fail when
 * this commit never serves. Runs the real script against a fake wrangler and curl.
 */

const script = resolve(dirname(fileURLToPath(import.meta.url)), "forgegraph-deploy-report.sh");
const SHA = "28e68c5f9291d7f954684c8e675f933de3d1562d";
const OLD = "f640bce47f5ab316ee1a96ee5806b625afef6e51";

function run({ staleChecks, attempts = 4 }) {
  const dir = mkdtempSync(join(tmpdir(), "deploy-report-"));
  try {
    // `deployments status` reports the old version for the first staleChecks calls.
    const wrangler = join(dir, "wrangler");
    writeFileSync(wrangler, `#!/usr/bin/env node
const fs = require("node:fs");
const counter = ${JSON.stringify(join(dir, "calls"))};
const args = process.argv.slice(2);
if (args[0] === "deployments") {
  const n = fs.existsSync(counter) ? Number(fs.readFileSync(counter, "utf8")) : 0;
  fs.writeFileSync(counter, String(n + 1));
  const id = n < ${staleChecks} ? "old-version" : "new-version";
  process.stdout.write(JSON.stringify({ versions: [{ version_id: id, percentage: 100 }] }));
} else if (args[0] === "versions") {
  const text = args[2] === "new-version" ? ${JSON.stringify(SHA)} : ${JSON.stringify(OLD)};
  process.stdout.write(JSON.stringify({ resources: { bindings: [{ name: "FG_COMMIT_HASH", type: "plain_text", text }] } }));
} else process.exit(2);
`);
    const curl = join(dir, "curl");
    writeFileSync(curl, `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
if (args.some((a) => a.endsWith("/api/fg/deploys/complete"))) {
  fs.writeFileSync(${JSON.stringify(join(dir, "report.json"))}, args[args.indexOf("--data-binary") + 1]);
  process.stdout.write("{}");
} else process.stdout.write("200");
`);
    chmodSync(wrangler, 0o755);
    chmodSync(curl, 0o755);
    const result = spawnSync("bash", [script, "success", "bob", "blder-bot", "https://bob.test/api/health"], {
      encoding: "utf8",
      env: {
        PATH: `${dir}:${process.env.PATH}`,
        WRANGLER: wrangler,
        GITHUB_SHA: SHA,
        GITHUB_RUN_ID: "1672",
        FG_API_TOKEN: "test-token",
        STAMP_ATTEMPTS: String(attempts),
        STAMP_RETRY_SECONDS: "0",
      },
    });
    let report = null;
    try { report = JSON.parse(readFileSync(join(dir, "report.json"), "utf8")); } catch { /* not reported */ }
    return { ...result, report };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("waits for this commit's version to serve, then reports success", () => {
  const r = run({ staleChecks: 2 });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /stamp attempt 1: the version serving 100% is not this commit yet/);
  assert.equal(r.report.status, "success");
  assert.equal(r.report.commitSha, SHA);
  assert.equal(r.report.workerVersion, "new-version");
});

test("fails without reporting when this commit never serves", () => {
  const r = run({ staleChecks: 100, attempts: 3 });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, new RegExp(`not stamped FG_COMMIT_HASH=${SHA} after 3 checks`));
  assert.equal(r.report, null);
});

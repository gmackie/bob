import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { verifyRunnerSource } from "../apps/ooda-runner/ops/verify-running-source.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "ooda-source-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const checkout = join(root, "checkout");
  const runner = join(checkout, "apps/ooda-runner");
  mkdirSync(join(runner, "src"), { recursive: true });
  writeFileSync(join(runner, "src/index.ts"), "// runner fixture\n");
  const git = (...args) => execFileSync("git", ["-C", checkout, ...args], {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  git("init", "--quiet");
  git("add", "apps/ooda-runner/src/index.ts");
  git("-c", "user.name=Test", "-c", "user.email=test@localhost", "commit", "--quiet", "-m", "fixture");
  const sha = git("rev-parse", "HEAD");
  const proc = join(root, "proc");
  mkdirSync(join(proc, "123"), { recursive: true });
  function processAt(cwd, args = ["node", "--import", "tsx/esm", "src/index.ts"]) {
    rmSync(join(proc, "123/cwd"), { force: true });
    symlinkSync(cwd, join(proc, "123/cwd"));
    writeFileSync(join(proc, "123/cmdline"), args.join("\0") + "\0");
  }
  processAt(runner);
  return { root, checkout, runner, sha, proc, processAt };
}

test("accepts the expected revision actually running from its own checkout", (t) => {
  const f = fixture(t);
  assert.equal(verifyRunnerSource(f.checkout, f.sha, "123", f.proc), f.sha);
  f.processAt(f.runner, ["node", "--import", "tsx/esm", join(f.runner, "src/index.ts")]);
  assert.equal(verifyRunnerSource(f.checkout, f.sha, "123", f.proc), f.sha);
});

test("rejects an old active release even when the deployment checkout is current", (t) => {
  const f = fixture(t);
  const oldRunner = join(f.root, "old-release/apps/ooda-runner");
  mkdirSync(oldRunner, { recursive: true });
  f.processAt(oldRunner);
  assert.throws(() => verifyRunnerSource(f.checkout, f.sha, "123", f.proc), /working directory/);
});

test("rejects inherited ancestor Git metadata for an archive", (t) => {
  const f = fixture(t);
  const archive = join(f.checkout, "archive");
  const runner = join(archive, "apps/ooda-runner");
  mkdirSync(runner, { recursive: true });
  f.processAt(runner);
  assert.throws(() => verifyRunnerSource(archive, f.sha, "123", f.proc), /repository root/);
});

test("rejects a different entrypoint in the expected directory", (t) => {
  const f = fixture(t);
  f.processAt(f.runner, ["node", "src/other.ts"]);
  assert.throws(() => verifyRunnerSource(f.checkout, f.sha, "123", f.proc), /entrypoint/);
  f.processAt(f.runner, ["node", "src/other.ts", "src/index.ts"]);
  assert.throws(() => verifyRunnerSource(f.checkout, f.sha, "123", f.proc), /entrypoint/);
});

test("rejects a stale source revision and a vanished process", (t) => {
  const f = fixture(t);
  assert.throws(() => verifyRunnerSource(f.checkout, "0".repeat(40), "123", f.proc), /revision/);
  assert.throws(() => verifyRunnerSource(f.checkout, f.sha, "999", f.proc));
});

test("a shadowing systemd drop-in is refused before restarting the live service", (t) => {
  const f = fixture(t);
  const bin = join(f.root, "bin");
  const oldRunner = join(f.root, "old-release");
  mkdirSync(bin);
  mkdirSync(oldRunner);
  const trace = join(f.root, "systemctl.trace");
  writeFileSync(join(bin, "install"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  writeFileSync(join(bin, "systemctl"), `#!/bin/sh
printf '%s\\n' "$*" >> "$SOURCE_GUARD_TRACE"
case "$1" in
  daemon-reload) exit 0 ;;
  show) printf '%s\\n' "$SOURCE_GUARD_OLD_RELEASE" ;;
  *) exit 77 ;;
esac
`, { mode: 0o755 });
  const deploy = readFileSync(fileURLToPath(new URL("../apps/ooda-runner/deploy-hetzner-bob.sh", import.meta.url)), "utf8");
  const remoteService = deploy.split("<<'REMOTE_SERVICE'\n")[1].split("\nREMOTE_SERVICE")[0];
  const result = spawnSync("bash", ["-s", "--", f.checkout, f.sha, "bob"], {
    input: remoteService, encoding: "utf8",
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, SOURCE_GUARD_TRACE: trace, SOURCE_GUARD_OLD_RELEASE: oldRunner },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Refusing deployment: effective WorkingDirectory/);
  assert.doesNotMatch(readFileSync(trace, "utf8"), /restart/);
});

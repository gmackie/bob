import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Inspect the process, not just the checkout that the deploy command updated.
export function verifyRunnerSource(deployDir, expectedSha, pid, procRoot = "/proc") {
  if (!/^[0-9a-f]{40}$/.test(expectedSha) || !/^[1-9][0-9]*$/.test(pid)) {
    throw new Error("Expected an exact source revision and a live process ID");
  }
  const checkout = realpathSync(deployDir);
  const expectedCwd = realpathSync(join(checkout, "apps/ooda-runner"));
  const cwd = realpathSync(join(procRoot, pid, "cwd"));
  if (cwd !== expectedCwd) {
    throw new Error(`Active working directory ${cwd} differs from ${expectedCwd}`);
  }
  const git = (...args) => execFileSync("git", ["-C", checkout, ...args], {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  if (realpathSync(git("rev-parse", "--show-toplevel")) !== checkout) {
    throw new Error("Active source has no matching repository root; ancestor Git metadata is not provenance");
  }
  const actualSha = git("rev-parse", "HEAD");
  if (actualSha !== expectedSha) {
    throw new Error(`Active source revision ${actualSha} differs from ${expectedSha}`);
  }
  const args = readFileSync(join(procRoot, pid, "cmdline"), "utf8").split("\0").filter(Boolean);
  const entrypoints = new Set([join(cwd, "src/index.ts"), join(cwd, "dist/index.js")]);
  let entrypoint;
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (["-e", "--eval", "-p", "--print", "--check"].includes(arg)) break;
    if (["--import", "--loader", "--experimental-loader", "--require", "-r"].includes(arg)) {
      i++;
      continue;
    }
    if (arg === "--") {
      entrypoint = args[i + 1];
      break;
    }
    if (arg.startsWith("-")) continue;
    entrypoint = arg;
    break;
  }
  let actualEntrypoint;
  try {
    if (entrypoint) actualEntrypoint = realpathSync(resolve(cwd, entrypoint));
  } catch {
    // Missing scripts never establish the active source.
  }
  if (!entrypoints.has(actualEntrypoint)) {
    throw new Error("Active process does not run the expected OODA runner entrypoint");
  }
  return actualSha;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [deployDir, sha, pid] = process.argv.slice(2);
    console.log(`OODA runner active at ${verifyRunnerSource(deployDir, sha, pid)}`);
  } catch (error) {
    console.error(`OODA runner source verification failed: ${error.message}`);
    process.exitCode = 1;
  }
}

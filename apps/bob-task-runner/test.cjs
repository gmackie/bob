// CI passes Vitest-specific reporting flags through Turbo to every test task.
// Keep Node's native test runner here; the phase wrapper still records this
// package's exit status as complete evidence in the deployment matrix.
const { spawnSync } = require("node:child_process");
const ignored = new Set([
  "--no-file-parallelism",
  "--reporter=default",
  "--reporter=@forgegraph/check-events/reporters/vitest",
]);
const args = process.argv.slice(2).filter((arg) => !ignored.has(arg));
const result = spawnSync(
  process.execPath,
  ["--test", ...args, require.resolve("./task-runner.test.cjs")],
  { stdio: "inherit" },
);
process.exitCode = result.status ?? 1;

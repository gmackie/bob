const { test } = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, existsSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { spawnSync } = require("node:child_process");
test("import is inert: no credentials, filesystem writes, health probes or dispatch", () => {
  const dir = mkdtempSync(join(tmpdir(), "bob-task-test-"));
  try {
    const state = join(dir, "untouched");
    const result = spawnSync(
      process.execPath,
      [
        "-e",
        `process.argv.push('--once','--dry-run');require(${JSON.stringify(resolve(__dirname, "task-runner.js"))});`,
      ],
      {
        env: {
          PATH: process.env.PATH,
          BOB_RUNNER_STATE_DIR: state,
          BOB_RUNNER_PROJECTS: "{}",
          LINEAR_KEY_FILE: join(dir, "absent"),
        },
        encoding: "utf8",
      },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(state), false);
    assert.equal(result.stdout, "");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
const cp = require("node:child_process");
const fs = require("node:fs");
const { createRunner } = require("./task-runner.js");
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "bob-task-git-"));
  const remote = join(dir, "remote");
  const repo = join(dir, "repo");
  const git = (cwd, ...args) =>
    cp
      .execFileSync("git", args, {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      })
      .trim();
  git(dir, "init", "--bare", "--initial-branch=release", remote);
  git(dir, "clone", remote, repo);
  git(repo, "config", "user.name", "Test");
  git(repo, "config", "user.email", "test@example.invalid");
  git(repo, "commit", "--allow-empty", "-m", "base");
  git(repo, "push", "-u", "origin", "release");
  git(repo, "remote", "set-head", "origin", "release");
  return {
    dir,
    repo,
    remote,
    git,
    close: () => rmSync(dir, { recursive: true, force: true }),
  };
}
const issue = {
  id: "issue-1",
  identifier: "TEST-1",
  title: "fixture task",
  description: "",
  updatedAt: new Date().toISOString(),
  priority: 1,
};
function runnerFor(
  f,
  {
    exitCode = 0,
    pushFails = false,
    noCommit = false,
    countFails = false,
    argv = [],
  } = {},
) {
  const finished = [];
  const runner = createRunner({
    env: { BOB_RUNNER_STATE_DIR: join(f.dir, "state") },
    argv,
    childProcess: {
      ...cp,
      execFileSync: (cmd, args, opts) => {
        if (countFails && args[0] === "rev-list")
          throw Error("unreadable base history");
        if (pushFails && args[0] === "push") throw Error("push rejected");
        return cp.execFileSync(cmd, args, opts);
      },
    },
    services: {
      bobStartRun: async () => ({ id: "run", agentType: "fake" }),
      runAgent: async (_, cwd) => {
        if (!noCommit)
          f.git(cwd, "commit", "--allow-empty", "-m", "agent work");
        return { exitCode, output: "done" };
      },
      noteRunOutcome: () => {},
      bobPushLog: async () => {},
      bobFinishRun: async (_id, status, summary) => {
        finished.push({ status, summary });
      },
      addIssueComment: async () => {},
      updateIssueState: async () => {},
    },
  });
  return { runner, finished };
}
test("discovers nonstandard remote HEAD, preserves commits, and requires successful push", async () => {
  const f = fixture();
  try {
    const { runner, finished } = runnerFor(f);
    assert.equal(
      await runner.processIssue(issue, "fixture", f.repo),
      "completed",
    );
    assert.equal(f.git(f.repo, "branch", "--show-current"), "bob/test-1");
    assert.equal(
      f.git(f.repo, "rev-list", "--count", "origin/release..HEAD"),
      "1",
    );
    assert.equal(finished[0].summary.pushed, true);
  } finally {
    f.close();
  }
});
test("agent failure and push rejection never complete and preserve commits", async () => {
  for (const config of [{ exitCode: 7 }, { pushFails: true }]) {
    const f = fixture();
    try {
      const { runner, finished } = runnerFor(f, config);
      assert.notEqual(
        await runner.processIssue(issue, "fixture", f.repo),
        "completed",
      );
      assert.equal(
        f.git(f.repo, "rev-list", "--count", "origin/release..HEAD"),
        "1",
      );
      assert.equal(finished[0].status, "failed");
      assert.equal(finished[0].summary.pushed, false);
    } finally {
      f.close();
    }
  }
});
test("missing base or user dirt fails explicitly without deleting work", async () => {
  for (const dirty of [false, true]) {
    const f = fixture();
    try {
      f.git(f.repo, "commit", "--allow-empty", "-m", "user work");
      const before = f.git(f.repo, "rev-parse", "HEAD");
      if (dirty) fs.writeFileSync(join(f.repo, "user.txt"), "keep");
      else
        f.git(f.repo, "symbolic-ref", "--delete", "refs/remotes/origin/HEAD");
      const { runner, finished } = runnerFor(f);
      assert.equal(
        await runner.processIssue(issue, "fixture", f.repo),
        "setup_failed",
      );
      assert.equal(f.git(f.repo, "rev-parse", "HEAD"), before);
      assert.equal(finished[0].status, "failed");
      if (dirty)
        assert.equal(fs.readFileSync(join(f.repo, "user.txt"), "utf8"), "keep");
    } finally {
      f.close();
    }
  }
});
test("dry run main performs no mkdir, claims, cloning, health probes or mutations", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bob-dry-"));
  try {
    const state = join(dir, "never-created");
    const mutations = [];
    const runner = createRunner({
      argv: ["--dry-run", "--once"],
      env: {
        BOB_RUNNER_STATE_DIR: state,
        BOB_RUNNER_PROJECTS: JSON.stringify({ fixture: "project" }),
        BOB_RUNNER_REPOS: JSON.stringify({ fixture: dir }),
      },
      services: {
        getUnstartedIssues: async () => [issue],
        checkAgentHealth: () => {
          mutations.push("health");
        },
        dispatchDecision: () => {
          mutations.push("health");
          return { paused: false };
        },
        bobStartRun: async () => {
          mutations.push("claim");
        },
      },
    });
    await runner.main();
    assert.equal(existsSync(state), false);
    assert.deepEqual(mutations, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("clone cooldown skips broken highest-priority repo without starving others and retries later", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bob-backoff-"));
  const good = join(dir, "good");
  const bad = join(dir, "bad");
  fs.mkdirSync(good);
  let time = Date.now();
  let cloneAttempts = 0;
  let recovered = false;
  const processed = [];
  const runner = createRunner({
    argv: ["--once"],
    now: () => time,
    remoteRepos: {
      bad: { projectId: "bad-project", repoSlug: "test/bad", localPath: bad },
    },
    env: {
      BOB_RUNNER_STATE_DIR: join(dir, "state"),
      BOB_RUNNER_PROJECTS: JSON.stringify({
        bad: "bad-project",
        good: "good-project",
      }),
      BOB_RUNNER_REPOS: JSON.stringify({ good }),
    },
    childProcess: {
      ...cp,
      execFileSync: (cmd, args) => {
        assert.equal(cmd, "git");
        if (args[0] === "rev-parse") return "true";
        assert.equal(args[0], "clone");
        cloneAttempts++;
        if (!recovered) throw Error("offline");
        fs.mkdirSync(bad);
        return Buffer.from("");
      },
    },
    services: {
      checkAgentHealth: () => {},
      dispatchDecision: () => ({ paused: false }),
      getUnstartedIssues: async (project) => [
        { ...issue, id: project, priority: project === "bad-project" ? 1 : 2 },
      ],
      processIssue: async (_, slug) => {
        processed.push(slug);
        return "completed";
      },
    },
  });
  try {
    await runner.main();
    assert.deepEqual(processed, ["good"]);
    assert.equal(cloneAttempts, 2);
    await runner.runOnce();
    assert.equal(cloneAttempts, 2);
    time += 300001;
    recovered = true;
    await runner.runOnce();
    assert.equal(cloneAttempts, 3);
    assert.deepEqual(processed, ["good", "bad"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("no-commit and unreadable-history outcomes retain the branch for recovery", async () => {
  for (const config of [{ noCommit: true }, { countFails: true }]) {
    const f = fixture();
    try {
      const { runner, finished } = runnerFor(f, config);
      const result = await runner.processIssue(issue, "fixture", f.repo);
      assert.equal(
        result,
        config.noCommit ? "no_changes" : "commit_count_failed",
      );
      assert.equal(f.git(f.repo, "branch", "--show-current"), "bob/test-1");
      assert.equal(finished[0].status, "failed");
      assert.equal(finished[0].summary.pushed, false);
    } finally {
      f.close();
    }
  }
});

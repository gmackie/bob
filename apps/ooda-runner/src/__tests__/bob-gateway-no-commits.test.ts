import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@gmacko/core/telemetry/deep", async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(),
  withTraceSpan: async (_name: string, fn: () => Promise<unknown>) => fn(),
}));
import { BobGatewayConnector, requiresCodeChange } from "../bob-gateway";

const research = { source: { system: "gentrellis-research", hypothesisId: "h1" } };
const dirs: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** git stub: `ahead` commits on the branch; a non-empty net diff when ahead > 0. */
function gitStub(ahead: number) {
  return vi.fn(async (_cwd: string, args: string[]) => {
    if (args[0] === "rev-list") return `${ahead}\n`;
    if (args[0] === "diff") throw new Error("differs");
    if (args[0] === "remote") return "https://git.example/owner/repo.git\n";
    return "";
  });
}

function connectorFor(ahead: number) {
  const dir = mkdtempSync(join(tmpdir(), "bob-no-commits-")); dirs.push(dir);
  // The runner only prepares a worktree for a git checkout.
  mkdirSync(join(dir, ".git"));
  const worktree = { path: dir, repoPath: dir, branch: "bob/abcd1234/hypothesis", baseBranch: "master" };
  const connector = Object.create(BobGatewayConnector.prototype) as Record<string, any>;
  Object.assign(connector, {
    config: { maxConcurrent: 1, t3: { serverUrl: "http://t3", authToken: "t" } },
    activeSessions: new Map(), adapters: new Map(), sessionHandles: new Map(),
    stopRequested: new Set(), supervisedSessions: new Set(),
    canRunAgent: () => true, sendDurable: vi.fn(), sendStatus: vi.fn(), sendEvent: vi.fn(),
    setupWorktree: vi.fn().mockResolvedValue(worktree),
    detectBaseBranch: vi.fn().mockResolvedValue("master"),
    installBobCheck: vi.fn(), buildSystemPrompt: () => "",
    runWithT3: vi.fn().mockResolvedValue(undefined),
    git: gitStub(ahead),
    createPullRequest: vi.fn().mockResolvedValue("https://git.example/owner/repo/pulls/7"),
    removeWorktree: vi.fn().mockResolvedValue(undefined),
    supervisedRunStillLive: () => false, superviseDir: () => join(dir, "supervise"),
    reportToBizPulse: vi.fn(), recordSkillfleetRun: vi.fn(), reportOodaOutcome: vi.fn(),
    bobReporter: {
      startRun: vi.fn().mockResolvedValue("run-1"), pushLog: vi.fn().mockResolvedValue(undefined),
      finishRun: vi.fn().mockResolvedValue(undefined),
    },
  });
  return { connector, worktree, dir };
}

function sessionFor(dir: string, metadata?: Record<string, unknown>) {
  return {
    type: "session_available", sessionId: "s-research", workItemId: "wi-1", title: "Hypothesis",
    workingDirectory: dir, branch: "bob/abcd1234/hypothesis", agentType: "codex",
    ...(metadata ? { personaConfig: { metadata } } : {}),
  };
}

describe("requiresCodeChange", () => {
  it("is true only for GenTrellis research dispatches", () => {
    expect(requiresCodeChange({ personaConfig: { metadata: research } })).toBe(true);
    expect(requiresCodeChange({ personaConfig: { metadata: { source: { system: "kanbanger" } } } })).toBe(false);
    expect(requiresCodeChange({})).toBe(false);
  });

  it("recognizes research prompts dispatched before the source was recorded", () => {
    expect(requiresCodeChange({
      description: "You are implementing one research hypothesis as a real code change. Compare against refs/autolab/champion.",
    })).toBe(true);
  });
});

describe("terminal outcome after the agent exits", () => {
  it("reports a research run without commits as an error, not completed", async () => {
    const { connector, dir } = connectorFor(0);
    await connector.handleSessionAvailable(sessionFor(dir, research));

    const statuses = connector.sendStatus.mock.calls.map((c: unknown[]) => c[1]);
    expect(statuses).not.toContain("completed");
    expect(connector.sendStatus).toHaveBeenLastCalledWith("s-research", "error", {
      code: "NO_COMMITS",
      error: "agent finished without committing any changes",
      branch: "bob/abcd1234/hypothesis",
    });
    expect(connector.bobReporter.finishRun).toHaveBeenCalledWith("run-1", "failed", expect.objectContaining({ code: "NO_COMMITS" }));
    expect(connector.reportOodaOutcome).toHaveBeenCalledWith(expect.anything(), "failed", expect.anything());
    expect(connector.recordSkillfleetRun).toHaveBeenCalledWith(expect.anything(), "failure", expect.any(Number));
    expect(connector.createPullRequest).not.toHaveBeenCalled();
  });

  it("keeps a no-commit run successful when the dispatch is not research", async () => {
    const { connector, dir } = connectorFor(0);
    await connector.handleSessionAvailable(sessionFor(dir));
    expect(connector.sendStatus).toHaveBeenLastCalledWith("s-research", "completed", undefined);
    expect(connector.bobReporter.finishRun).toHaveBeenCalledWith("run-1", "completed", expect.anything());
  });

  it("completes a research run that produced commits and opens its PR", async () => {
    const { connector, dir } = connectorFor(2);
    await connector.handleSessionAvailable(sessionFor(dir, research));
    expect(connector.sendStatus).toHaveBeenLastCalledWith("s-research", "completed", {
      pullRequestUrl: "https://git.example/owner/repo/pulls/7",
      branch: "bob/abcd1234/hypothesis",
      baseBranch: "master",
    });
  });

  it("reports an adopted research run without commits as an error", async () => {
    const { connector, worktree } = connectorFor(0);
    await connector.finalizeAdoptedRun(
      { session: sessionFor(worktree.path, research), worktree },
      "s-research",
    );
    expect(connector.sendStatus).toHaveBeenLastCalledWith("s-research", "error", expect.objectContaining({
      code: "NO_COMMITS",
    }));
    expect(connector.reportOodaOutcome).toHaveBeenCalledWith(expect.anything(), "failed", expect.anything());
  });
});

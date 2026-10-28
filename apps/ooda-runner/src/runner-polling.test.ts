import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RunnerConfigSchema } from "./config";
import {
  POLL_ACTIVE_GRACE_MS,
  POLL_ACTIVE_INTERVAL_MS,
  POLL_IDLE_MAX_INTERVAL_MS,
  PollBackoff,
} from "./poll-backoff";
const api = vi.hoisted(() => ({
  runner: {
    register: { mutate: vi.fn(async () => [{ id: "runner-test" }]) },
    heartbeat: { mutate: vi.fn(async () => undefined) },
    reapStaleSessions: { mutate: vi.fn(async () => ({ reaped: 0 })) },
    listSessionsByRunner: {
      query: vi.fn<() => Promise<unknown[]>>(async () => []),
    },
    claimSession: { mutate: vi.fn(async () => null) },
    getSessionEvents: {
      query: vi.fn<
        () => Promise<{ id: string; type: string; content: string }[]>
      >(async () => []),
    },
    pushSessionEvent: { mutate: vi.fn(async () => undefined) },
  },
  jobs: { claim: { mutate: vi.fn<() => Promise<unknown>>(async () => null) } },
  research: {},
  threads: {
    byId: {
      query: vi.fn<() => Promise<{ slug: string; title: string } | null>>(
        async () => null,
      ),
    },
  },
}));
vi.mock("./trpc-client", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  createRunnerTRPCClient: () => api,
}));
// The job worker's hourly scratch sweep does real filesystem I/O, which fake
// time cannot advance; stub it so a tick's duration is purely simulated.
vi.mock("./agent-jobs/scratch-sandbox", () => ({
  ScratchSandboxManager: class {
    async cleanupExpired(): Promise<void> {}
  },
}));
import { PROMOTION_RESCAN_INTERVAL_MS, RunnerServer } from "./runner-server";
let server: RunnerServer | undefined;
let root: string | undefined;
afterEach(async () => {
  await server?.stop();
  server = undefined;
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  api.runner.listSessionsByRunner.query.mockReset();
  api.runner.listSessionsByRunner.query.mockResolvedValue([]);
  api.runner.getSessionEvents.query.mockReset();
  api.runner.getSessionEvents.query.mockResolvedValue([]);
  api.jobs.claim.mutate.mockReset();
  api.jobs.claim.mutate.mockResolvedValue(null);
  if (root) rmSync(root, { recursive: true, force: true });
  root = undefined;
});

function useFakeClock(): void {
  vi.useFakeTimers({
    toFake: [
      "setTimeout",
      "clearTimeout",
      "setInterval",
      "clearInterval",
      "Date",
    ],
  });
}

async function startServer(
  prefix: string,
  overrides: Record<string, unknown> = {},
): Promise<RunnerServer> {
  root = mkdtempSync(join(tmpdir(), prefix));
  server = new RunnerServer(
    RunnerConfigSchema.parse({
      storageRoot: root,
      agentJobScratchRoot: join(root, "scratch"),
      hostTurnEnabled: false,
      ...overrides,
    }),
  );
  await server.start();
  return server;
}

/** Times (ms since start) at which listSessionsByRunner was called. */
function recordPollTimes(): number[] {
  const startedAt = Date.now();
  const times: number[] = [];
  api.runner.listSessionsByRunner.query.mockImplementation(async () => {
    times.push(Date.now() - startedAt);
    return [];
  });
  return times;
}

describe("PollBackoff", () => {
  it("stays active through the grace window, then doubles to the ceiling", () => {
    const backoff = new PollBackoff({ now: 0 });
    const delays: number[] = [];
    let now = 0;
    for (let i = 0; i < 40; i++) {
      const delay = backoff.next(false, now);
      delays.push(delay);
      now += delay;
    }
    // 30 active ticks cover the 60s grace window.
    expect(delays.slice(0, 30)).toEqual(Array(30).fill(2_000));
    expect(delays.slice(30, 35)).toEqual([4_000, 8_000, 16_000, 20_000, 20_000]);
    expect(Math.max(...delays)).toBe(POLL_IDLE_MAX_INTERVAL_MS);
  });

  it("drops straight back to the active interval on work", () => {
    const backoff = new PollBackoff({ now: 0 });
    let now = 0;
    for (let i = 0; i < 40; i++) now += backoff.next(false, now);
    expect(backoff.next(false, now)).toBe(20_000);
    expect(backoff.next(true, now)).toBe(2_000);
    // ...and stays there for the grace window after the work.
    expect(backoff.next(false, now + POLL_ACTIVE_GRACE_MS - 1)).toBe(2_000);
    expect(backoff.next(false, now + POLL_ACTIVE_GRACE_MS)).toBe(4_000);
  });

  it("never goes below the active interval or above a custom ceiling", () => {
    const backoff = new PollBackoff({ now: 0, idleMaxMs: 1_000 });
    expect(backoff.next(false, POLL_ACTIVE_GRACE_MS)).toBe(
      POLL_ACTIVE_INTERVAL_MS,
    );
    const capped = new PollBackoff({ now: 0, idleMaxMs: 30_000 });
    let now = POLL_ACTIVE_GRACE_MS;
    let delay = 0;
    for (let i = 0; i < 20; i++) {
      delay = capped.next(false, now);
      now += delay;
    }
    expect(delay).toBe(30_000);
  });
});

it("backs off an idle runner, so an hour costs a fraction of the fixed 2s poll", async () => {
  useFakeClock();
  const times = recordPollTimes();
  await startServer("runner-idle-");
  await vi.advanceTimersByTimeAsync(60 * 60_000);

  const gaps = times.slice(1).map((time, i) => time - times[i]!);
  expect(times[0]).toBe(2_000);
  expect(Math.max(...gaps)).toBe(20_000);
  expect(gaps.slice(-10)).toEqual(Array(10).fill(20_000));
  // A fixed 2s poll is 1,800 per hour. Backoff: 30 in the first minute, a few
  // ramping, then 3 a minute: under 210, a cut of more than 88%.
  expect(times.length).toBeLessThan(210);
  // jobs.claim shares the tick, so it backs off with it.
  expect(api.jobs.claim.mutate).toHaveBeenCalledTimes(times.length);
});

it("returns to 2s polling as soon as a pending session appears", async () => {
  useFakeClock();
  const times = recordPollTimes();
  await startServer("runner-wake-");
  await vi.advanceTimersByTimeAsync(10 * 60_000);
  const idleCount = times.length;
  const startedAt = Date.now() - 10 * 60_000;

  // A session arrives: the next poll (at most 20s away) sees it.
  api.runner.listSessionsByRunner.query.mockImplementation(async () => {
    times.push(Date.now() - startedAt);
    return [
      {
        id: "pending-session",
        status: "pending",
        threadId: "thread-test",
        runnerId: "runner-test",
      },
    ];
  });
  await vi.advanceTimersByTimeAsync(POLL_IDLE_MAX_INTERVAL_MS + 10_000);
  expect(api.runner.claimSession.mutate).toHaveBeenCalledWith({
    sessionId: "pending-session",
  });
  // Worst case pickup on an idle runner: one idle interval.
  const lastIdle = times[idleCount - 1]!;
  const firstActive = times[idleCount]!;
  expect(firstActive - lastIdle).toBeLessThanOrEqual(POLL_IDLE_MAX_INTERVAL_MS);
  const gaps = times
    .slice(idleCount + 1)
    .map((time, i) => time - times[idleCount + i]!);
  expect(gaps.length).toBeGreaterThanOrEqual(4);
  expect(new Set(gaps)).toEqual(new Set([2_000]));
});

it("returns to 2s polling when jobs.claim hands out work", async () => {
  useFakeClock();
  const times = recordPollTimes();
  await startServer("runner-job-wake-");
  await vi.advanceTimersByTimeAsync(10 * 60_000);
  const idleCount = times.length;

  // A job for a provider this runner lacks: claimed (activity) but not run.
  api.jobs.claim.mutate.mockResolvedValueOnce({
    job: { id: "job-1", provider: "no-such-provider" },
  });
  await vi.advanceTimersByTimeAsync(POLL_IDLE_MAX_INTERVAL_MS + 6_000);
  const after = times.slice(idleCount);
  // The tick that claimed the job, then 2s ticks for the grace window.
  expect(after[0]! - times[idleCount - 1]!).toBe(POLL_IDLE_MAX_INTERVAL_MS);
  expect(after.slice(1).map((time, i) => time - after[i]!)).toEqual(
    Array(after.length - 1).fill(2_000),
  );
  expect(after.length).toBeGreaterThanOrEqual(3);
});

it("does not overlap slow polls, and resumes after a rejected worker", async () => {
  useFakeClock();
  let finish!: (rows: unknown[]) => void;
  api.runner.listSessionsByRunner.query
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValue([]);
  api.jobs.claim.mutate.mockRejectedValueOnce(
    Error("temporary worker failure"),
  );
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  await startServer("runner-poll-");
  await vi.advanceTimersByTimeAsync(2000);
  await vi.advanceTimersByTimeAsync(6000);
  expect(api.runner.listSessionsByRunner.query).toHaveBeenCalledTimes(1);
  finish([]);
  await vi.advanceTimersByTimeAsync(0);
  expect(warn).toHaveBeenCalledWith("[runner] poll failed:", expect.any(Error));
  await vi.advanceTimersByTimeAsync(2000);
  expect(api.runner.listSessionsByRunner.query).toHaveBeenCalledTimes(2);
});

it("re-reads a session's events only on first sight, status change, or after the rescan interval", async () => {
  useFakeClock();
  let status = "running";
  api.runner.listSessionsByRunner.query.mockImplementation(async () => [
    {
      id: "running-session",
      status,
      threadId: "thread-test",
      runnerId: "runner-test",
    },
  ]);
  await startServer("runner-scan-");
  await vi.advanceTimersByTimeAsync(2_000);
  expect(api.runner.getSessionEvents.query).toHaveBeenCalledTimes(1);

  // Unchanged session on later 2s ticks: no event read.
  await vi.advanceTimersByTimeAsync(PROMOTION_RESCAN_INTERVAL_MS - 2_000);
  expect(api.runner.listSessionsByRunner.query.mock.calls.length).toBeGreaterThan(5);
  expect(api.runner.getSessionEvents.query).toHaveBeenCalledTimes(1);

  // The rescan interval has passed: one more read.
  await vi.advanceTimersByTimeAsync(4_000);
  expect(api.runner.getSessionEvents.query).toHaveBeenCalledTimes(2);

  // A status change triggers an immediate read.
  status = "pending";
  await vi.advanceTimersByTimeAsync(2_000);
  expect(api.runner.getSessionEvents.query).toHaveBeenCalledTimes(3);
});

it("processes promotion requests from completed sessions and writes a durable note", async () => {
  useFakeClock();
  api.runner.listSessionsByRunner.query.mockResolvedValue([
    {
      id: "completed-session",
      status: "completed",
      threadId: "thread-test",
      runnerId: "runner-test",
    },
  ]);
  api.runner.getSessionEvents.query.mockResolvedValue([
    {
      id: "request-1",
      type: "promote_request",
      content: JSON.stringify({
        runnerId: "runner-test",
        threadId: "thread-test",
        kind: "observation",
        title: "Keep this result",
        content: "Completed output retained",
      }),
    },
  ]);
  api.threads.byId.query.mockResolvedValue({
    slug: "terminal-thread",
    title: "Terminal thread",
  });
  await startServer("runner-terminal-");
  await vi.advanceTimersByTimeAsync(2000);
  await vi.waitFor(() =>
    expect(api.runner.pushSessionEvent.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "completed-session",
        type: "promotion_available",
      }),
    ),
  );
  const noteDir = join(root!, "terminal-thread", "notes");
  const notes = readdirSync(noteDir);
  expect(notes).toHaveLength(1);
  expect(readFileSync(join(noteDir, notes[0]!), "utf8")).toContain(
    "Completed output retained",
  );
});

it("waits for an active poll before completing shutdown", async () => {
  useFakeClock();
  let finish!: (rows: unknown[]) => void;
  api.runner.listSessionsByRunner.query.mockImplementationOnce(
    () => new Promise((resolve) => { finish = resolve; }),
  );
  await startServer("runner-drain-");
  await vi.advanceTimersByTimeAsync(2000);
  let stopped = false;
  const stopping = server!.stop().then(() => { stopped = true; });
  try {
    await vi.advanceTimersByTimeAsync(0);
    expect(stopped).toBe(false);
  } finally {
    finish([]);
    await stopping;
    server = undefined;
  }
  expect(stopped).toBe(true);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(api.runner.listSessionsByRunner.query).toHaveBeenCalledTimes(1);
});

import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RunnerConfigSchema } from "./config";
const api = vi.hoisted(() => ({
  runner: {
    register: { mutate: vi.fn(async () => [{ id: "runner-test" }]) },
    listSessionsByRunner: { query: vi.fn<() => Promise<unknown[]>>() },
    getSessionEvents: {
      query: vi.fn<
        () => Promise<{ id: string; type: string; content: string }[]>
      >(async () => []),
    },
    pushSessionEvent: { mutate: vi.fn(async () => undefined) },
  },
  jobs: { claim: { mutate: vi.fn(async () => null) } },
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
import { RunnerServer } from "./runner-server";
let server: RunnerServer | undefined;
let root: string | undefined;
afterEach(async () => {
  await server?.stop();
  server = undefined;
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  if (root) rmSync(root, { recursive: true, force: true });
});
it("does not overlap slow polls, and resumes after a rejected worker", async () => {
  root = mkdtempSync(join(tmpdir(), "runner-poll-"));
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
  server = new RunnerServer(
    RunnerConfigSchema.parse({
      storageRoot: root,
      agentJobScratchRoot: join(root, "scratch"),
      hostTurnEnabled: false,
    }),
  );
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  await server.start();
  await vi.advanceTimersByTimeAsync(2000);
  await vi.advanceTimersByTimeAsync(6000);
  expect(api.runner.listSessionsByRunner.query).toHaveBeenCalledTimes(1);
  finish([]);
  await new Promise((resolve) => setTimeout(resolve, 20));
  await vi.advanceTimersByTimeAsync(2000);
  expect(api.runner.listSessionsByRunner.query).toHaveBeenCalledTimes(2);
  expect(warn).toHaveBeenCalledWith("[runner] poll failed:", expect.any(Error));
});

it("processes promotion requests from completed sessions and writes a durable note", async () => {
  root = mkdtempSync(join(tmpdir(), "runner-terminal-"));
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
  server = new RunnerServer(
    RunnerConfigSchema.parse({
      storageRoot: root,
      agentJobScratchRoot: join(root, "scratch"),
      hostTurnEnabled: false,
    }),
  );
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  await server.start();
  await vi.advanceTimersByTimeAsync(2000);
  expect(api.runner.pushSessionEvent.mutate).toHaveBeenCalledWith(
    expect.objectContaining({
      sessionId: "completed-session",
      type: "promotion_available",
    }),
  );
  const noteDir = join(root, "terminal-thread", "notes");
  const notes = readdirSync(noteDir);
  expect(notes).toHaveLength(1);
  expect(readFileSync(join(noteDir, notes[0]!), "utf8")).toContain(
    "Completed output retained",
  );
});

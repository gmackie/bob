import { EventEmitter } from "node:events";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  type ExecutionChild,
  createShutdownHandler,
  runExecutionService,
} from "./runtime";

class FakeChild extends EventEmitter {
  kill = vi.fn();

  override on(
    event: "error" | "exit",
    listener: ((error: Error) => void) | ((code: number | null, signal: NodeJS.Signals | null) => void),
  ): this {
    return super.on(event, listener as (...args: any[]) => void);
  }

  override once(
    event: "exit",
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): this {
    return super.once(event, listener);
  }
}

describe("execution runtime", () => {
  const originalExitCode = process.exitCode;

  afterEach(() => {
    process.exitCode = originalExitCode;
    vi.restoreAllMocks();
  });

  it("returns immediately when no runtime children are enabled", async () => {
    const info = vi.fn();

    await runExecutionService({
      config: {
        gateway: {
          name: "gateway",
          enabled: false,
          command: "pnpm",
          args: [],
          cwd: "/tmp/bob",
        },
      },
      logger: {
        info,
        error: vi.fn(),
      },
      startChild: () => {
        throw new Error("should not start children");
      },
    });

    expect(info).toHaveBeenCalledWith("[execution] gateway child process disabled");
    expect(info).toHaveBeenCalledWith("[execution] no runtime children enabled; exiting");
  });

  it("forwards shutdown signals to all children", () => {
    const first = new FakeChild();
    const second = new FakeChild();
    const info = vi.fn();

    const shutdown = createShutdownHandler(
      [first, second] as ExecutionChild[],
      {
      info,
      error: vi.fn(),
      },
    );

    shutdown("SIGTERM");

    expect(info).toHaveBeenCalledWith(
      "[execution] received SIGTERM; forwarding shutdown",
    );
    expect(first.kill).toHaveBeenCalledWith("SIGTERM");
    expect(second.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("waits for the gateway child to exit", async () => {
    const child = new FakeChild();
    const info = vi.fn();
    const runPromise = runExecutionService({
      config: {
        gateway: {
          name: "gateway",
          enabled: true,
          command: "pnpm",
          args: ["--filter", "@bob/gateway", "dev"],
          cwd: "/tmp/bob",
        },
      },
      logger: {
        info,
        error: vi.fn(),
      },
      startChild: () => child as ExecutionChild,
    });

    child.emit("exit", 0, null);

    await runPromise;

    expect(info).toHaveBeenCalledWith("[execution] starting gateway child process");
    expect(info).toHaveBeenCalledWith("[execution] gateway exited with code 0");
  });
});

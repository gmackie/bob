import { expect, it, vi } from "vitest";

import { SessionControl } from "./session-control.js";

it("cancellation during setup prevents later spawn attachment and escalates until actual close", () => {
  vi.useFakeTimers();
  const kill = vi.fn();
  const c = new SessionControl(kill);
  c.stop();
  expect(c.signal.aborted).toBe(true);
  const child = { pid: 123, kill: vi.fn() };
  c.attach(child);
  expect(kill).toHaveBeenCalledWith(child, "SIGTERM");
  vi.advanceTimersByTime(5000);
  expect(kill).toHaveBeenCalledWith(child, "SIGKILL");
  c.closed();
  vi.useRealTimers();
});
it("observed close cancels escalation", () => {
  vi.useFakeTimers();
  const kill = vi.fn();
  const c = new SessionControl(kill);
  c.attach({ pid: 1, kill: vi.fn() });
  c.stop();
  c.closed();
  vi.advanceTimersByTime(5000);
  expect(kill).toHaveBeenCalledTimes(2);
  expect(kill).toHaveBeenLastCalledWith(
    expect.objectContaining({ pid: 1 }),
    "SIGKILL",
  );
  vi.useRealTimers();
});

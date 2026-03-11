import { describe, expect, it } from "vitest";

import {
  buildResult,
  clampRunOutput,
  createDefaultMcporterPolicy,
  createRequestId,
  truncateUtf8,
  utf8ByteLength,
  validateCommandSpec,
} from "@linear-clone/shared";

describe("mcporter adapter primitives", () => {
  it("creates request ids with stable prefix", () => {
    const id = createRequestId("x");
    expect(id.startsWith("x_")).toBe(true);
  });

  it("validates command allowlist", () => {
    const policy = createDefaultMcporterPolicy();

    expect(validateCommandSpec({ command: "jj", args: [] }, policy).ok).toBe(true);
    expect(validateCommandSpec({ command: "rm", args: ["-rf", "/"] }, policy).ok).toBe(false);
  });

  it("enforces timeout and output ceilings", () => {
    const policy = createDefaultMcporterPolicy();

    const tooSlow = validateCommandSpec(
      { command: "jj", args: [], timeoutMs: policy.maxTimeoutMs + 1 },
      policy
    );
    expect(tooSlow.ok).toBe(false);

    const tooBig = validateCommandSpec(
      { command: "jj", args: [], maxOutputBytes: policy.maxOutputBytes + 1 },
      policy
    );
    expect(tooBig.ok).toBe(false);
  });

  it("truncates output by UTF-8 byte budget", () => {
    const input = "hello world";
    const full = truncateUtf8(input, utf8ByteLength(input));
    expect(full.truncated).toBe(false);
    expect(full.text).toBe(input);

    const tiny = truncateUtf8(input, 5);
    expect(tiny.truncated).toBe(true);
    expect(utf8ByteLength(tiny.text)).toBeLessThanOrEqual(5);
  });

  it("clamps both stdout and stderr", () => {
    const clamped = clampRunOutput({
      stdout: "x".repeat(1000),
      stderr: "y".repeat(1000),
      maxOutputBytes: 100,
    });

    expect(clamped.truncated.stdout).toBe(true);
    expect(clamped.truncated.stderr).toBe(true);
    expect(utf8ByteLength(clamped.stdout)).toBeLessThanOrEqual(100);
    expect(utf8ByteLength(clamped.stderr)).toBeLessThanOrEqual(100);
  });

  it("builds results with duration and truncation", () => {
    const result = buildResult({
      requestId: "req_1",
      exitCode: 0,
      stdout: "ok".repeat(200),
      stderr: "",
      startedAtMs: 1000,
      finishedAtMs: 2500,
      maxOutputBytes: 10,
    });

    expect(result.durationMs).toBe(1500);
    expect(result.truncated.stdout).toBe(true);
  });
});

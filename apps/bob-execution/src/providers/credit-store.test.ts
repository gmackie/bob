import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FileCreditStore } from "./credit-store.js";
import { CreditLatch } from "./credit.js";

let dir: string;
let path: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "credit-store-"));
  path = join(dir, "credit-state.json");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("FileCreditStore", () => {
  it("round-trips latched state", () => {
    const store = new FileCreditStore(path);
    store.write({ grok: { detail: "402 Payment Required", at: "2026-08-29T00:00:00.000Z" } });

    expect(new FileCreditStore(path).read()).toMatchObject({
      grok: { detail: "402 Payment Required" },
    });
  });

  it("returns empty state when the file does not exist", () => {
    expect(new FileCreditStore(join(dir, "absent.json")).read()).toEqual({});
  });

  it("returns empty state rather than throwing on corrupt JSON", () => {
    // A malformed state file must never take the daemon down on boot.
    writeFileSync(path, "{not json");
    expect(new FileCreditStore(path).read()).toEqual({});
  });

  it("writes the file 0600 — it records account status", () => {
    const store = new FileCreditStore(path);
    store.write({ grok: { detail: "402", at: "2026-08-29T00:00:00.000Z" } });

    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it("does not throw when the directory is unwritable", () => {
    const store = new FileCreditStore("/proc/nonexistent/credit-state.json");
    expect(() => store.write({ grok: { detail: "x", at: "now" } })).not.toThrow();
  });
});

describe("CreditLatch durability", () => {
  it("survives a restart — a broke agent must not come back up looking ready", () => {
    // bob-execution.service is Restart=always/RestartSec=10. An in-memory-only
    // latch would report `ready` ten seconds after every crash and resume the
    // exact backlog burn this feature exists to stop.
    const latch = new CreditLatch(new FileCreditStore(path));
    latch.noteRunOutcome("grok", { code: 1, stderr: "402 Payment Required — balance exhausted" });

    const afterRestart = new CreditLatch(new FileCreditStore(path));

    expect(afterRestart.isLatched("grok")).toBe(true);
    expect(afterRestart.detail("grok")).toContain("balance exhausted");
  });

  it("persists the clear as well as the latch", () => {
    const latch = new CreditLatch(new FileCreditStore(path));
    latch.noteRunOutcome("grok", { code: 1, stderr: "402 Payment Required" });
    latch.noteRunOutcome("grok", { code: 0, stdout: "ok" });

    expect(new CreditLatch(new FileCreditStore(path)).isLatched("grok")).toBe(false);
  });

  it("shares state across processes — the runner and the daemon cannot disagree", () => {
    const daemon = new CreditLatch(new FileCreditStore(path));
    daemon.noteRunOutcome("grok", { code: 1, stderr: "402 Payment Required" });

    // A separate process reading the same file sees the same verdict.
    const runner = new CreditLatch(new FileCreditStore(path));
    expect(runner.isLatched("grok")).toBe(true);
  });

  it("works with no store at all", () => {
    const latch = new CreditLatch();
    latch.noteRunOutcome("grok", { code: 1, stderr: "402 Payment Required" });
    expect(latch.isLatched("grok")).toBe(true);
  });

  it("ignores unknown providers found in the state file", () => {
    writeFileSync(path, JSON.stringify({ "not-a-provider": { detail: "x", at: "now" } }));
    expect(() => new CreditLatch(new FileCreditStore(path))).not.toThrow();
  });

  it("does not persist a secret that leaked into provider output", () => {
    const latch = new CreditLatch(new FileCreditStore(path));
    latch.noteRunOutcome("grok", {
      code: 1,
      stderr: "402 Payment Required key sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    });

    expect(readFileSync(path, "utf8")).not.toContain("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
  });
});

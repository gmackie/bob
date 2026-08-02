import { describe, it, expect } from "vitest";

import {
  reconciledRunStatus,
  isActiveAgentRunStatus,
  reconcileRunAgainstSession,
} from "./reconcile-runs.js";

describe("reconciledRunStatus (session terminal → run terminal)", () => {
  it("maps session terminal statuses to the implied run status", () => {
    expect(reconciledRunStatus("completed")).toBe("completed");
    expect(reconciledRunStatus("failed")).toBe("failed");
    expect(reconciledRunStatus("error")).toBe("failed");
    expect(reconciledRunStatus("interrupted")).toBe("interrupted");
    expect(reconciledRunStatus("stopped")).toBe("interrupted");
  });

  it("returns null for any non-terminal session status (leave the run alone)", () => {
    for (const s of ["running", "queued", "blocked", "host_unknown", "starting", "idle", ""]) {
      expect(reconciledRunStatus(s)).toBeNull();
    }
  });
});

describe("isActiveAgentRunStatus", () => {
  it("recognizes the active agent_run statuses", () => {
    for (const s of ["queued", "running", "blocked", "host_unknown"]) {
      expect(isActiveAgentRunStatus(s)).toBe(true);
    }
  });
  it("rejects terminal / unknown statuses", () => {
    for (const s of ["completed", "failed", "interrupted", "stopped", "error", "done", ""]) {
      expect(isActiveAgentRunStatus(s)).toBe(false);
    }
  });
});

describe("reconcileRunAgainstSession (safe by construction)", () => {
  it("finalizes an active run whose session is terminal", () => {
    expect(reconcileRunAgainstSession("running", "completed")).toBe("completed");
    expect(reconcileRunAgainstSession("blocked", "failed")).toBe("failed");
    expect(reconcileRunAgainstSession("host_unknown", "stopped")).toBe("interrupted");
    expect(reconcileRunAgainstSession("queued", "interrupted")).toBe("interrupted");
  });

  it("NEVER touches a run whose session is still active (can't stomp a live run)", () => {
    expect(reconcileRunAgainstSession("running", "running")).toBeNull();
    expect(reconcileRunAgainstSession("blocked", "blocked")).toBeNull();
    expect(reconcileRunAgainstSession("running", "host_unknown")).toBeNull();
  });

  it("NEVER re-touches an already-terminal run (only active → terminal)", () => {
    expect(reconcileRunAgainstSession("completed", "completed")).toBeNull();
    expect(reconcileRunAgainstSession("failed", "failed")).toBeNull();
    expect(reconcileRunAgainstSession("interrupted", "completed")).toBeNull();
  });
});

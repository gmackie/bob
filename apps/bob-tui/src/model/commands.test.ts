import { describe, expect, it } from "vitest";
import { COMMAND_LIMITS, type CommandOption } from "@bob/sdlc-view";

import { applyStatus, asCommandStatus, clientCommand, emptyCommands, expire, latestFor, MAX_KEPT, recordSent, statusText, toResend } from "./commands";

const option: CommandOption = { label: "Pause plan", tier: 1, command: { operation: "ControlPlan", input: { planId: "p1", expectedVersion: 2, action: "pause" } } };
const op = (state: "succeeded" | "failed") => ({ contractVersion: "1" as const, operationId: "op1", commandId: "c1", state, resourceId: "p1", resourceVersion: 3 });

describe("command lifecycle", () => {
  it("builds the ClientCommand with the confirmation", () => {
    expect(clientCommand("c1", option, { confirmed: true })).toEqual({
      type: "command", commandId: "c1", operation: "ControlPlan", input: { planId: "p1", expectedVersion: 2, action: "pause" }, confirm: { confirmed: true },
    });
  });

  it("goes pending → accepted → succeeded, and ignores later statuses", () => {
    let s = recordSent(emptyCommands(), clientCommand("c1", option), "Pause plan p1", 0);
    expect(s.entries.c1!.status).toBe("pending");
    s = applyStatus(s, { type: "commandAccepted", commandId: "c1" });
    expect(statusText(s.entries.c1!)).toBe("Pause plan p1: accepted, waiting for the coordinator");
    s = applyStatus(s, { type: "commandResult", commandId: "c1", ok: true, operation: op("succeeded") });
    expect(statusText(s.entries.c1!)).toBe("Pause plan p1: succeeded (v3)");
    expect(applyStatus(s, { type: "commandRejected", commandId: "c1", code: "invalid", message: "x" })).toBe(s);
  });

  it("records rejections and failed operations", () => {
    const s = recordSent(emptyCommands(), clientCommand("c1", option), "Pause", 0);
    expect(applyStatus(s, { type: "commandRejected", commandId: "c1", code: "coordinator-offline", message: "no contact" }).entries.c1).toMatchObject({ status: "rejected", error: "coordinator-offline: no contact" });
    expect(applyStatus(s, { type: "commandResult", commandId: "c1", ok: false, error: { code: "VersionConflict", message: "stale", retryable: false } }).entries.c1!.status).toBe("failed");
    expect(applyStatus(s, { type: "commandResult", commandId: "c1", ok: true, operation: { ...op("failed"), error: { code: "E", message: "m", retryable: false } } }).entries.c1).toMatchObject({ status: "failed", error: "E: m" });
  });

  it("ignores statuses for other viewers' commands", () => {
    const s = emptyCommands();
    expect(applyStatus(s, { type: "commandAccepted", commandId: "nope" })).toBe(s);
  });

  it("resends only in-flight commands, with their original ids", () => {
    let s = recordSent(emptyCommands(), clientCommand("c1", option), "a", 0);
    s = recordSent(s, clientCommand("c2", option), "b", 0);
    s = recordSent(s, clientCommand("c3", option), "c", 0);
    s = applyStatus(s, { type: "commandAccepted", commandId: "c2" });
    s = applyStatus(s, { type: "commandResult", commandId: "c3", ok: true, operation: op("succeeded") });
    expect(toResend(s).map((c) => c.commandId)).toEqual(["c1", "c2"]);
    expect(latestFor(s, "p1")!.command.commandId).toBe("c3");
  });

  it("expires in-flight commands after the edge's outbox expiry", () => {
    const s = recordSent(emptyCommands(), clientCommand("c1", option), "a", 0);
    expect(expire(s, COMMAND_LIMITS.expireAfterMs)).toBe(s);
    const e = expire(s, COMMAND_LIMITS.expireAfterMs + 1);
    expect(e.entries.c1!.status).toBe("expired");
    expect(toResend(e)).toEqual([]);
  });

  it("keeps a bounded history but never drops in-flight commands", () => {
    let s = emptyCommands();
    for (let i = 0; i < MAX_KEPT + 10; i++) {
      s = recordSent(s, clientCommand(`c${i}`, option), "x", 0);
      if (i > 0) s = applyStatus(s, { type: "commandRejected", commandId: `c${i}`, code: "invalid", message: "" });
    }
    expect(s.order.length).toBe(MAX_KEPT);
    expect(s.entries.c0!.status).toBe("pending");
  });

  it("parses status messages and nothing else", () => {
    expect(asCommandStatus({ type: "commandAccepted", commandId: "c1" })).not.toBeNull();
    expect(asCommandStatus({ type: "commandResult", commandId: "c1" })).toBeNull();
    expect(asCommandStatus({ type: "snapshot" })).toBeNull();
    expect(asCommandStatus(null)).toBeNull();
  });
});

import { beforeEach, describe, expect, it } from "vitest";

import { DispatchControl } from "./dispatch-control.js";

type Result = { code: number; stdout: string; stderr: string };

let calls: string[];
let sent: Record<string, unknown>[];
/** Per-verb results — `is-active` answers differently from `start`/`stop`. */
let results: Record<string, Result>;
let control: DispatchControl;

const ACTIVE: Result = { code: 0, stdout: "active\n", stderr: "" };
const INACTIVE: Result = { code: 3, stdout: "inactive\n", stderr: "" };
const OK: Result = { code: 0, stdout: "", stderr: "" };

function lastSent() {
  return sent.at(-1) as { detail?: string } | undefined;
}

beforeEach(() => {
  calls = [];
  sent = [];
  results = { "is-active": ACTIVE, start: OK, stop: OK };
  control = new DispatchControl({
    send: (msg) => sent.push(msg),
    run: (command, args) => {
      calls.push([command, ...args].join(" "));
      const verb = args.find((a) => a in results) ?? "";
      return Promise.resolve(results[verb] ?? OK);
    },
  });
});

describe("DispatchControl", () => {
  it("reports the unit as running when systemd says active", async () => {
    expect(await control.isRunning()).toBe(true);
  });

  it("reports the unit as stopped when systemd exits non-zero", async () => {
    // `systemctl is-active` exits 3 for an inactive unit, so a non-zero exit is
    // the normal answer here, not an error.
    results["is-active"] = INACTIVE;
    expect(await control.isRunning()).toBe(false);
  });

  it("starts the runner and confirms the new state", async () => {
    await control.apply("req-1", "start");

    expect(calls).toContain("sudo -n systemctl start bob-task-runner.service");
    expect(lastSent()).toMatchObject({
      type: "dispatch_state",
      requestId: "req-1",
      ok: true,
      running: true,
    });
  });

  it("stops the runner and reports it as no longer running", async () => {
    results["is-active"] = INACTIVE;
    await control.apply("req-2", "stop");

    expect(calls).toContain("sudo -n systemctl stop bob-task-runner.service");
    expect(lastSent()).toMatchObject({ type: "dispatch_state", ok: true, running: false });
  });

  it("reports what systemd says, not what was asked for", async () => {
    // A unit that dies instantly on start (bad .env, missing binary) must not
    // be reported as running just because `systemctl start` returned 0.
    results["is-active"] = INACTIVE;
    await control.apply("req-3", "start");

    expect(lastSent()).toMatchObject({ ok: true, running: false });
  });

  it("never takes the unit name from the caller", async () => {
    // The action arrives over a websocket. If the unit were part of the
    // message, a forged frame would be arbitrary command execution as root.
    await control.apply("req-4", "start");

    for (const call of calls) {
      const units = call.split(" ").filter((a) => a.endsWith(".service"));
      expect(units).toEqual(["bob-task-runner.service"]);
    }
  });

  it("rejects an unknown action rather than shelling out", async () => {
    await control.apply("req-5", "restart-everything" as never);

    expect(calls).toEqual([]);
    expect(lastSent()).toMatchObject({ type: "dispatch_state", requestId: "req-5", ok: false });
  });

  it("reports a failure when systemctl cannot start the unit", async () => {
    results.start = { code: 1, stdout: "", stderr: "Failed to start unit: Access denied" };
    await control.apply("req-6", "start");

    expect(lastSent()).toMatchObject({ type: "dispatch_state", ok: false, running: false });
    expect(lastSent()?.detail).toContain("Access denied");
  });

  it("redacts secrets out of a systemd failure detail", async () => {
    results.start = {
      code: 1,
      stdout: "",
      stderr: "start failed for ops@example.com token sk-abcdefghijklmnop",
    };
    await control.apply("req-7", "start");

    expect(lastSent()?.detail).not.toContain("ops@example.com");
    expect(lastSent()?.detail).not.toContain("sk-abcdefghijklmnop");
  });
});

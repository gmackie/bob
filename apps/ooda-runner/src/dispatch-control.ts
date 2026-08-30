/**
 * Start and stop the standalone task runner from the UI.
 *
 * The circuit breaker in @bob/execution stops a *running* runner from claiming
 * work against dead agents, and it lifts itself the moment an agent is healthy
 * again. But a runner that has been stopped at the systemd level cannot un-stop
 * itself, and bob-task-runner polls Linear directly — it holds no connection to
 * Bob, so nothing in the UI could ever reach it. That left "SSH in and run
 * systemctl" as the only way back, which is the exact hole the credential work
 * was meant to close.
 *
 * ooda-runner does hold the gateway socket, so it acts as the control plane for
 * its neighbour on the same host.
 *
 * The unit name is a constant here and is never read from the wire. The action
 * arrives over a websocket, so a name taken from the message would turn a
 * forged frame into arbitrary command execution as root.
 */

import { execFile } from "node:child_process";

import { redactDetail } from "@bob/execution/providers";

/** The one unit this control plane may touch. Deliberately not configurable. */
const UNIT = "bob-task-runner.service";

const CONTROL_TIMEOUT_MS = 30_000;

export type DispatchAction = "start" | "stop";

const ACTIONS: readonly DispatchAction[] = ["start", "stop"];

function runSystemctl(command: string, args: string[]) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
    execFile(command, args, { timeout: CONTROL_TIMEOUT_MS }, (error, stdout, stderr) => {
      resolve({
        // A non-zero exit is a normal answer for `is-active`, not a throw.
        code: typeof error?.code === "number" ? error.code : error ? 1 : 0,
        stdout,
        stderr,
      });
    });
  });
}

export interface DispatchControlOptions {
  send: (msg: Record<string, unknown>) => void;
  /** Injectable so tests never touch the host's systemd. */
  run?: typeof runSystemctl;
}

export class DispatchControl {
  constructor(private readonly opts: DispatchControlOptions) {}

  private get run() {
    return this.opts.run ?? runSystemctl;
  }

  /**
   * `systemctl is-active` exits 3 when the unit is inactive, so the exit code
   * is the signal and a non-zero exit is not an error.
   */
  async isRunning(): Promise<boolean> {
    const result = await this.run("sudo", ["-n", "systemctl", "is-active", UNIT]);
    return result.code === 0 && result.stdout.trim() === "active";
  }

  async apply(requestId: string, action: DispatchAction): Promise<void> {
    if (!ACTIONS.includes(action)) {
      this.opts.send({
        type: "dispatch_state",
        requestId,
        ok: false,
        running: false,
        detail: `unknown dispatch action ${String(action)}`,
      });
      return;
    }

    const result = await this.run("sudo", ["-n", "systemctl", action, UNIT]);
    if (result.code !== 0) {
      this.opts.send({
        type: "dispatch_state",
        requestId,
        ok: false,
        running: false,
        // systemd quotes the unit's environment on failure, so scrub before
        // this reaches a browser.
        detail: redactDetail(`${result.stderr}\n${result.stdout}`) || `systemctl ${action} failed`,
      });
      return;
    }

    // Report what systemd actually says now, not what we asked for.
    const running = await this.isRunning();
    this.opts.send({ type: "dispatch_state", requestId, ok: true, running });
  }
}

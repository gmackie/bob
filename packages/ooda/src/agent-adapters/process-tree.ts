import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";

type ProcessTreeTarget = {
  pid?: number;
  kill: (...args: never[]) => unknown;
};

const KILL_GRACE_MS = 1_000;
const GROUP_POLL_MS = 25;
const pendingEscalations = new Map<number, NodeJS.Timeout>();

function signalProcessGroup(pid: number, signal: NodeJS.Signals): boolean {
  try {
    process.kill(-pid, signal);
    return true;
  } catch {
    return false;
  }
}

function processGroupExists(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch {
    return false;
  }
}

function scheduleProcessGroupEscalation(pid: number): void {
  if (pendingEscalations.has(pid)) return;
  const startedAt = Date.now();
  const timer = setInterval(() => {
    if (!processGroupExists(pid)) {
      clearInterval(timer);
      pendingEscalations.delete(pid);
      return;
    }
    if (Date.now() - startedAt < KILL_GRACE_MS) return;
    clearInterval(timer);
    pendingEscalations.delete(pid);
    signalProcessGroup(pid, "SIGKILL");
  }, GROUP_POLL_MS);
  timer.unref();
  pendingEscalations.set(pid, timer);
}

function terminateProcessGroup(pid: number, signal: NodeJS.Signals): boolean {
  const signalled = signalProcessGroup(pid, signal);
  if (signalled && signal !== "SIGKILL") {
    scheduleProcessGroupEscalation(pid);
  }
  return signalled;
}

export function spawnAdapterProcess(
  binary: string,
  args: string[],
  options: Omit<SpawnOptions, "detached">,
): ChildProcess {
  const child = spawn(binary, args, {
    ...options,
    detached: process.platform !== "win32",
  });
  const pid = child.pid;
  if (process.platform !== "win32" && pid) {
    child.once("exit", () => {
      terminateProcessGroup(pid, "SIGTERM");
    });
  }
  return child;
}

/**
 * Terminate a process-backed adapter without leaving commands it spawned
 * running after the agent exits. Direct adapters start as process-group
 * leaders; injected/supervised processes fall back to their control handle.
 */
export function killProcessTree(
  child: ProcessTreeTarget,
  signal: NodeJS.Signals,
): void {
  if (
    process.platform !== "win32" &&
    child.pid &&
    terminateProcessGroup(child.pid, signal)
  ) {
    return;
  }

  try {
    (child.kill as (requestedSignal: NodeJS.Signals) => unknown)(signal);
  } catch {
    // Shutdown and timeout cleanup must remain best effort and idempotent.
  }
}

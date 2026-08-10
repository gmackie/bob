import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";

type ProcessTreeTarget = {
  pid?: number;
  kill: (...args: never[]) => unknown;
};

function signalProcessGroup(pid: number, signal: NodeJS.Signals): boolean {
  try {
    process.kill(-pid, signal);
    return true;
  } catch {
    return false;
  }
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
    child.once("close", () => {
      signalProcessGroup(pid, "SIGTERM");
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
    signalProcessGroup(child.pid, signal)
  ) {
    return;
  }

  try {
    (child.kill as (requestedSignal: NodeJS.Signals) => unknown)(signal);
  } catch {
    // Shutdown and timeout cleanup must remain best effort and idempotent.
  }
}

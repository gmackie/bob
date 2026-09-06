import { execFile, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";

function alive(child: ChildProcess | number): boolean {
  const pid = typeof child === "number" ? child : child.pid;
  if (!pid) return false;
  if (process.platform === "win32" && typeof child !== "number") return child.exitCode === null && child.signalCode === null;
  try { process.kill(process.platform === "win32" ? pid : -pid, 0); return true; } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    // EPERM from signal 0 proves existence; it is not successful shutdown.
    if ((error as NodeJS.ErrnoException).code === "EPERM") return true;
    throw error;
  }
}

export function killProcessTreeNow(child: ChildProcess | number): void {
  const pid = typeof child === "number" ? child : child.pid;
  if (!pid) return;
  try {
    if (process.platform !== "win32") process.kill(-pid, "SIGKILL");
    else process.kill(pid, "SIGKILL");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}

/** Requires a detached POSIX child: its PID owns the process group. Wait for
 * group disappearance, not just the leader exit or ChildProcess.killed. */
export async function terminateProcessTree(
  child: ChildProcess | number | null,
  options: { graceMs?: number; killTimeoutMs?: number; onSignal?: (signal: NodeJS.Signals) => void } = {},
): Promise<void> {
  if (!child || !alive(child)) return;
  const pid = typeof child === "number" ? child : child.pid!;
  const signal = async (value: "SIGTERM" | "SIGKILL") => {
    options.onSignal?.(value);
    if (process.platform === "win32") {
      await promisify(execFile)("taskkill", ["/pid", String(pid), "/T", ...(value === "SIGKILL" ? ["/F"] : [])]).catch((error) => {
        if (alive(child)) throw error;
      });
    } else {
      try { process.kill(-pid, value); } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      }
    }
  };
  const wait = async (duration: number) => {
    const deadline = Date.now() + duration;
    while (alive(child) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
    return !alive(child);
  };
  await signal("SIGTERM");
  if (await wait(options.graceMs ?? 3_000)) return;
  await signal("SIGKILL");
  if (!(await wait(options.killTimeoutMs ?? 2_000))) throw new Error("Child process group did not exit after SIGKILL");
}

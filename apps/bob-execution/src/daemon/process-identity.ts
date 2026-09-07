import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";

import type { ProcessIdentity } from "./durable-journal.js";

/** Signal 0 includes zombies on Linux: only non-exited group members can
 * still execute work. Keep unreadable /proc state as an error, never success. */
function linuxGroupHasLiveMembers(groupId: number): boolean {
  for (const entry of readdirSync("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const stat = readFileSync(`/proc/${entry}/stat`, "utf8");
      const fields = stat
        .slice(stat.lastIndexOf(")") + 2)
        .trim()
        .split(/\s+/);
      if (
        Number(fields[2]) === groupId &&
        fields[0] !== "Z" &&
        fields[0] !== "X"
      )
        return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return false;
}

export function processFingerprint(pid: number): string | null {
  if (process.platform === "linux") {
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
      const fields = stat
        .slice(stat.lastIndexOf(")") + 2)
        .trim()
        .split(/\s+/);
      if (fields[0] === "Z" || fields[0] === "X") return null;
      return `${fields[19]}:${readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim()}`;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }
  if (process.platform === "darwin") {
    try {
      const identity = execFileSync(
        "/bin/ps",
        ["-ww", "-p", String(pid), "-o", "lstart=,command="],
        { encoding: "utf8" },
      ).trim();
      return identity
        ? createHash("sha256").update(identity).digest("hex")
        : null;
    } catch (error) {
      if ((error as { status?: number }).status === 1) return null;
      throw error;
    }
  }
  throw Error("Process recovery unsupported on this platform");
}
export async function stopRecordedProcess(
  identity: ProcessIdentity,
  deps: {
    fingerprint: (pid: number) => string | null;
    kill: (pid: number, signal: NodeJS.Signals | 0) => unknown;
    groupHasLiveMembers?: (pid: number) => boolean;
  } = {
    fingerprint: processFingerprint,
    groupHasLiveMembers: (pid) =>
      process.platform !== "linux" || linuxGroupHasLiveMembers(pid),
    kill: (pid: number, signal: NodeJS.Signals | 0) =>
      process.kill(pid, signal),
  },
): Promise<void> {
  const groupExists = () => {
    try {
      deps.kill(-identity.pid, 0);
      return deps.groupHasLiveMembers?.(identity.pid) ?? true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
      throw error;
    }
  };
  const current = deps.fingerprint(identity.pid);
  if (current === null) {
    if (groupExists())
      throw Error("Orphan process group requires explicit recovery");
    return;
  }
  if (current !== identity.fingerprint)
    throw Error("Process identity changed; explicit recovery required");
  deps.kill(-identity.pid, "SIGTERM");
  const end = Date.now() + 5000;
  while (
    Date.now() < end &&
    deps.fingerprint(identity.pid) === identity.fingerprint
  )
    await new Promise((r) => setTimeout(r, 25));
  // The group may retain descendants after its leader exits. Only signal while
  // the recorded leader still matches; an ambiguous orphan group requires an operator.
  const after = deps.fingerprint(identity.pid);
  if (after === identity.fingerprint) {
    deps.kill(-identity.pid, "SIGKILL");
  } else if (after !== null)
    throw Error("Process identity changed during recovery");
  const deadline = Date.now() + 5000;
  while (
    deps.fingerprint(identity.pid) === identity.fingerprint ||
    groupExists()
  ) {
    if (Date.now() > deadline) throw Error("Process exit unconfirmed");
    await new Promise((r) => setTimeout(r, 25));
  }
}

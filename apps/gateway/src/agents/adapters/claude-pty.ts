/**
 * Claude PTY Adapter — spawns Claude Code in a real pseudo-terminal
 * for full interactive mode with multi-turn tool use support.
 *
 * This replaces the per-message spawning approach when node-pty is available.
 */

import type { IPty } from "node-pty";

let ptyModule: typeof import("node-pty") | null = null;

async function loadPty(): Promise<typeof import("node-pty")> {
  if (ptyModule) return ptyModule;
  try {
    ptyModule = await import("node-pty");
    return ptyModule;
  } catch {
    throw new Error("node-pty not available — install with: pnpm add node-pty");
  }
}

export interface ClaudePtySession {
  pty: IPty;
  onData: (callback: (data: string) => void) => void;
  write: (data: string) => void;
  kill: () => void;
}

export async function spawnClaudePty(
  workingDirectory: string,
  env: Record<string, string | undefined> = {},
): Promise<ClaudePtySession> {
  const nodePty = await loadPty();

  const pty = nodePty.spawn("claude", ["--output-format", "stream-json", "--verbose"], {
    name: "xterm-256color",
    cols: 200,
    rows: 50,
    cwd: workingDirectory || process.env.HOME || "/",
    env: {
      ...process.env,
      ...env,
      TERM: "xterm-256color",
    } as Record<string, string>,
  });

  console.log(`[ClaudePTY] Spawned claude PID=${pty.pid} in ${workingDirectory}`);

  return {
    pty,
    onData: (callback) => {
      pty.onData(callback);
    },
    write: (data) => {
      pty.write(data);
    },
    kill: () => {
      pty.kill();
    },
  };
}

export function isPtyAvailable(): boolean {
  try {
    require.resolve("node-pty");
    return true;
  } catch {
    return false;
  }
}

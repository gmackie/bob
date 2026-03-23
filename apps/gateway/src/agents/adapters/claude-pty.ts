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
    // Use require() for node-pty (native module, works better than ESM import)
    ptyModule = require("node-pty") as typeof import("node-pty");
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

let _ptyChecked = false;
let _ptyAvailable = false;

export function isPtyAvailable(): boolean {
  if (_ptyChecked) return _ptyAvailable;
  _ptyChecked = true;
  try {
    // Dynamic require works in tsx/Node.js even in ESM context
    const pty = require("node-pty");
    _ptyAvailable = !!pty?.spawn;
    console.log(`[ClaudePTY] node-pty availability check: ${_ptyAvailable}`);
  } catch (e) {
    console.log(`[ClaudePTY] node-pty not available: ${e}`);
    _ptyAvailable = false;
  }
  return _ptyAvailable;
}

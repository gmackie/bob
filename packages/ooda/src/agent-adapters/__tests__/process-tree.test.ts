import { afterEach, describe, expect, it } from "vitest";

import { killProcessTree, spawnAdapterProcess } from "../process-tree";

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForExit(pid: number): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (!isAlive(pid)) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Process ${pid} did not exit`);
}

describe("killProcessTree", () => {
  const survivors = new Set<number>();

  afterEach(() => {
    for (const pid of survivors) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // Already gone.
      }
    }
    survivors.clear();
  });

  it.runIf(process.platform !== "win32")(
    "terminates the agent and a command spawned beneath it",
    async () => {
      const leader = spawnAdapterProcess(
        process.execPath,
        [
          "-e",
          [
            'const { spawn } = require("node:child_process");',
            'const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });',
            'process.stdout.write(String(child.pid) + "\\n");',
            "setInterval(() => {}, 1000);",
          ].join(" "),
        ],
        { stdio: ["ignore", "pipe", "ignore"] },
      );
      const leaderPid = leader.pid;
      if (!leaderPid || !leader.stdout) throw new Error("Leader did not spawn");
      survivors.add(leaderPid);

      const childPid = await new Promise<number>((resolve, reject) => {
        leader.stdout!.once("data", (data: Buffer) => {
          const parsed = Number(data.toString().trim());
          if (!Number.isInteger(parsed)) reject(new Error("Missing child pid"));
          else resolve(parsed);
        });
        leader.once("error", reject);
      });
      survivors.add(childPid);

      expect(isAlive(leaderPid)).toBe(true);
      expect(isAlive(childPid)).toBe(true);

      killProcessTree(leader, "SIGTERM");

      await Promise.all([waitForExit(leaderPid), waitForExit(childPid)]);
      survivors.delete(leaderPid);
      survivors.delete(childPid);
    },
  );

  it.runIf(process.platform !== "win32")(
    "cleans up a background command when the agent exits normally",
    async () => {
      const leader = spawnAdapterProcess(
        process.execPath,
        [
          "-e",
          [
            'const { spawn } = require("node:child_process");',
            'const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });',
            'process.stdout.write(String(child.pid) + "\\n");',
            "setTimeout(() => process.exit(0), 50);",
          ].join(" "),
        ],
        { stdio: ["ignore", "pipe", "ignore"] },
      );
      const childPid = await new Promise<number>((resolve, reject) => {
        leader.stdout!.once("data", (data: Buffer) =>
          resolve(Number(data.toString().trim())),
        );
        leader.once("error", reject);
      });
      survivors.add(childPid);

      await new Promise<void>((resolve, reject) => {
        leader.once("close", () => resolve());
        leader.once("error", reject);
      });
      await waitForExit(childPid);
      survivors.delete(childPid);
    },
  );
});

import { spawn } from "node:child_process";
import { once } from "node:events";
import { describe, expect, it } from "vitest";
import { terminateProcessTree } from "./process-tree.js";

describe.skipIf(process.platform === "win32")("process tree termination", () => {
  it("kills a real child that ignores SIGTERM even after child.killed becomes true", async () => {
    const child = spawn(process.execPath, ["-e", "process.on('SIGTERM',()=>{}); console.log('ready'); setInterval(()=>{},1000)"], { detached: true, stdio: ["ignore", "pipe", "pipe"] });
    try {
      await once(child.stdout!, "data");
      child.kill("SIGTERM");
      expect(child.killed).toBe(true);
      await terminateProcessTree(child, { graceMs: 30 });
      expect(child.signalCode).toBe("SIGKILL");
    } finally { try { process.kill(-child.pid!, "SIGKILL"); } catch {} }
  });

  it("kills surviving descendants after their group leader exits", async () => {
    const script = `const {spawn}=require('node:child_process');
      const grandchild=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});console.log('ready');setInterval(()=>{},1000)"],{stdio:['ignore','pipe','ignore']});
      grandchild.stdout.once('data',()=>{ console.log(grandchild.pid); });
      process.on('SIGTERM',()=>process.exit(0)); setInterval(()=>{},1000);`;
    const child = spawn(process.execPath, ["-e", script], { detached: true, stdio: ["ignore", "pipe", "pipe"] });
    try {
      const [chunk] = await once(child.stdout!, "data");
      const grandchildPid = Number(String(chunk).trim());
      await terminateProcessTree(child, { graceMs: 60 });
      expect(() => process.kill(grandchildPid, 0)).toThrow();
    } finally { try { process.kill(-child.pid!, "SIGKILL"); } catch {} }
  });
});

describe.skipIf(process.platform === "win32")("process existence probes", () => {
  it("waits for disappearance after an EPERM probe instead of claiming shutdown", async () => {
    const { vi } = await import("vitest");
    let probes = 0;
    const kill = vi.spyOn(process, "kill").mockImplementation((_pid, signal) => {
      if (signal === 0) throw Object.assign(new Error("probe"), { code: probes++ === 0 ? "EPERM" : "ESRCH" });
      return true;
    });
    try {
      await terminateProcessTree(432109);
      expect(kill).toHaveBeenCalledWith(process.platform === "win32" ? 432109 : -432109, 0);
      expect(kill).toHaveBeenCalledWith(-432109, "SIGTERM");
      expect(probes).toBeGreaterThan(1);
    } finally { kill.mockRestore(); }
  });

  it("still rejects when permission prevents the actual termination signal", async () => {
    const { vi } = await import("vitest");
    const kill = vi.spyOn(process, "kill").mockImplementation(() => {
      throw Object.assign(new Error("permission denied"), { code: "EPERM" });
    });
    try { await expect(terminateProcessTree(432109)).rejects.toMatchObject({ code: "EPERM" }); }
    finally { kill.mockRestore(); }
  });
});

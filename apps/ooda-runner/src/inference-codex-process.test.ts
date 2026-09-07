import { expect, it, vi } from "vitest";
import {
  mkdtempSync,
  writeFileSync,
  existsSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { completeCodexInference } from "./inference-codex";
function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
it.skipIf(process.platform === "win32")(
  "waits for a non-cooperative Codex process tree to terminate on cancellation",
  async () => {
    const root = mkdtempSync(join(tmpdir(), "codex-process-"));
    const parentFile = join(root, "parent.pid");
    const childFile = join(root, "child.pid");
    writeFileSync(
      join(root, "codex"),
      `#!${process.execPath}\nconst fs=require('node:fs'); const {spawn}=require('node:child_process'); process.on('SIGTERM',()=>{}); fs.writeFileSync(${JSON.stringify(parentFile)},String(process.pid)); spawn(process.execPath,['-e',${JSON.stringify(`process.on('SIGTERM',()=>{}); require('node:fs').writeFileSync(${JSON.stringify(childFile)},String(process.pid)); setInterval(()=>{},1000);`)}],{stdio:'ignore'}); setInterval(()=>{},1000);`,
      { mode: 0o755 },
    );
    vi.stubEnv("PATH", `${root}:${process.env.PATH}`);
    const controller = new AbortController();
    const outcome = completeCodexInference({
      prompt: "test",
      workspaceRoot: root,
      signal: controller.signal,
    }).catch((error) => error);
    try {
      await expect
        .poll(() => existsSync(childFile), { timeout: 3000 })
        .toBe(true);
      controller.abort();
      expect(await outcome).toBeInstanceOf(Error);
      for (const file of [parentFile, childFile]) {
        const pid = Number(readFileSync(file, "utf8"));
        await expect.poll(() => alive(pid), { timeout: 2000 }).toBe(false);
      }
    } finally {
      controller.abort();
      for (const file of [parentFile, childFile]) {
        if (existsSync(file)) {
          try {
            process.kill(Number(readFileSync(file, "utf8")), "SIGKILL");
          } catch {}
        }
      }
      vi.unstubAllEnvs();
      rmSync(root, { recursive: true, force: true });
    }
  },
);

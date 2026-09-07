import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it, vi } from "vitest";
import { AgentCredentials } from "./agent-credentials";

it.skipIf(process.platform === "win32")("terminates a credential probe that ignores SIGTERM", async () => {
  const directory = mkdtempSync(join(tmpdir(), "credential-probe-"));
  const pidFile = join(directory, "probe.pid");
  writeFileSync(join(directory, "cursor-agent"), `#!${process.execPath}\nprocess.on('SIGTERM', () => {}); require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 1000);\n`, { mode: 0o755 });
  vi.stubEnv("PATH", directory);
  vi.stubEnv("BOB_CREDIT_STATE_PATH", join(directory, "credit.json"));
  const credentials = new AgentCredentials({ hostId: "fixture", daemonVersion: "test", send: () => {}, queueDepth: () => 0 });
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    const snapshot = await Promise.race([
      credentials.hostSnapshot(true),
      new Promise<never>((_, reject) => { deadline = setTimeout(() => reject(Error("Probe did not terminate within its timeout budget")), 12_000); }),
    ]);
    expect(snapshot.providers.find(provider => provider.provider === "cursor-agent")?.status).not.toBe("ready");
    const pid = Number(readFileSync(pidFile, "utf8"));
    expect(() => process.kill(pid, 0)).toThrow();
  } finally {
    if (deadline) clearTimeout(deadline);
    if (existsSync(pidFile)) {
      try { process.kill(Number(readFileSync(pidFile, "utf8")), "SIGKILL"); } catch {}
    }
    credentials.shutdown();
    vi.unstubAllEnvs();
    rmSync(directory, { recursive: true, force: true });
  }
}, 15_000);

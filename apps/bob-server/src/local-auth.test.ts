import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { localAuthEnvironment } from "./local-auth.js";

test("installation secret survives restart and origin changes without becoming the bootstrap token", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bob-local-auth-"));
  try {
    const first = await localAuthEnvironment(directory, "http://127.0.0.1:12345");
    const second = await localAuthEnvironment(directory, "http://127.0.0.1:23456");
    expect(first.AUTH_SECRET).toMatch(/^[a-f0-9]{96}$/);
    expect(second.AUTH_SECRET).toBe(first.AUTH_SECRET);
    expect(second.FRONTEND_URL).toBe("http://127.0.0.1:23456");
    expect((await stat(path.join(directory, "userdata/auth-secret"))).mode & 0o777).toBe(0o600);
    await writeFile(path.join(directory, "userdata/auth-secret"), "corrupt");
    await expect(localAuthEnvironment(directory, "http://127.0.0.1:23456")).rejects.toThrow("Invalid local");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("local auth rejects public bind addresses", async () => {
  await expect(localAuthEnvironment("/unused", "http://0.0.0.0:12345")).rejects.toThrow("loopback");
  await expect(localAuthEnvironment("/unused", "https://bob.example.com")).rejects.toThrow("loopback");
});

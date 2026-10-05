import { afterEach, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { PersistentVaultGate } from "../persistent-vault-gate";
import { VaultRouteHost } from "../vault-route-host";
import type { VaultService } from "../vault-service";

const dirs: string[] = [], gates: PersistentVaultGate[] = [];
afterEach(async () => {
  for (const gate of gates.splice(0)) gate.dispose();
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "vault-gate-")); dirs.push(dir);
  const path = join(dir, "gate.sqlite");
  const open = (generation = "one") => {
    const gate = new PersistentVaultGate(path, generation); gates.push(gate); return gate;
  };
  return { path, open };
}

it("excludes competing hosts and durably drains before switching generations", async () => {
  const { open } = await fixture();
  const a = open(), b = open();
  const binding = [{ actor: "alice", kind: "personal" as const, service: {} as VaultService }];
  const host = new VaultRouteHost(binding, a), other = new VaultRouteHost(binding, b);
  let release!: () => void, started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  const wait = new Promise<void>(resolve => { release = resolve; });
  const pending = host.execute("alice", "personal", async () => { started(); await wait; return "saved"; });
  await ready;
  await expect(other.execute("alice", "personal", async () => "bad")).rejects.toMatchObject({ code: "NotReady" });
  let drained = false;
  const drain = other.closeAndDrain().then(() => { drained = true; });
  expect(() => b.advance("two")).toThrow("not drained");
  expect(drained).toBe(false);
  release(); expect(await pending).toBe("saved"); await drain;
  await expect(open().execute(async () => "restart")).rejects.toMatchObject({ code: "NotReady" });
  b.advance("two");
  await expect(host.execute("alice", "personal", async () => "stale")).rejects.toMatchObject({ code: "NotReady" });
  const next = open("two"); expect(await next.execute(async () => "new")).toBe("new");
  await next.closeAndDrain();
  expect(() => next.advance("one")).toThrow("cannot be reused");
  // This integration case performs real SQLite FULL-synchronous commits.
  // Shared CI storage took 5.0–5.8s; its assertions specify durability and
  // authorization, not a five-second latency contract.
}, 20_000);

it("releases failed operations without leaving a false orphan", async () => {
  const { open } = await fixture(); const gate = open();
  await expect(gate.execute(async () => { throw Error("failure"); })).rejects.toThrow("failure");
  expect(await open().execute(async () => "next")).toBe("next");
});

it("keeps a killed process admission blocked across restart and refuses generation advance", async () => {
  const { path, open } = await fixture(); open();
  const module = new URL("../persistent-vault-gate.ts", import.meta.url).href;
  const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
    const {PersistentVaultGate}=await import(${JSON.stringify(module)});
    const gate=new PersistentVaultGate(${JSON.stringify(path)},'one');
    await gate.execute(async()=>{console.log('admitted');await new Promise(()=>{setInterval(()=>{},1000)});});
  `], { stdio: ["ignore", "pipe", "pipe"] });
  try {
    let output = "";
    await new Promise<void>((resolve, reject) => {
      child.stdout.on("data", data => { output += data; if (output.includes("admitted")) resolve(); });
      child.once("error", reject); child.once("exit", code => reject(Error(`Child exited ${code}`)));
    });
    const exit = once(child, "exit"); child.kill("SIGKILL"); await exit;
    const restarted = open();
    await expect(restarted.execute(async () => "unsafe")).rejects.toMatchObject({ code: "NotReady" });
    await expect(restarted.closeAndDrain(50)).rejects.toThrow("recovery required");
    expect(() => restarted.advance("two")).toThrow("not drained");
  } finally { child.kill("SIGKILL"); }
}, 15_000);

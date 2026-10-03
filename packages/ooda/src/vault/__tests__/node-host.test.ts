import { afterEach, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNodeVaultHostLoader, loadNodeVaultHost, type ConfiguredNodeVault } from "../node-host";
import { PersistentVaultGate } from "../persistent-vault-gate";

const dirs: string[] = [], hosts: ConfiguredNodeVault[] = [];
afterEach(async () => {
  for (const host of hosts.splice(0)) await host.close();
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "node-vault-host-")); dirs.push(root);
  const config = { version: 1, tenant: "t", actor: "alice", artifact: "vault", generation: "one", repositoryId: "repo", kind: "personal",
    vaultPath: join(root, "vault"), gatePath: join(root, "gate.sqlite"), journalPath: join(root, "journal"), clientModule: join(root, "client.mjs") };
  await mkdir(config.vaultPath); await mkdir(config.journalPath);
  new PersistentVaultGate(config.gatePath, config.generation).dispose();
  await writeFile(config.clientModule, `export async function createVaultClient(config) {
    if (!Object.isFrozen(config)) throw Error('Mutable identity');
    const revision={objectId:'a'.repeat(40),treeId:'b'.repeat(40),objectFormat:'sha1'};
    return {resolve:async()=>revision,commitWorkingTree:async()=>revision,remoteHead:async()=>({reachable:true,head:null}),currentRef:async()=>'refs/heads/main',publish:async()=>({outcome:'accepted'}),recover:async()=>({outcome:'observed'})};
  }`);
  const path = join(root, "config.json"); await writeFile(path, JSON.stringify(config));
  return { config, path };
}

it("shares one configured host and authorizes before file access", async () => {
  const { config, path } = await fixture();
  const load = createNodeVaultHostLoader({ OODA_FORGE_VAULT_CONFIG: path });
  const host = (await load())!; hosts.push(host);
  expect(await load()).toBe(host);
  await expect(host.routeHost.execute("mallory", "personal", service => service.write("denied.md", "bad"))).rejects.toMatchObject({ code: "NotAuthorized" });
  await expect(readFile(join(config.vaultPath, "denied.md"))).rejects.toMatchObject({ code: "ENOENT" });
  const result = await host.routeHost.execute("alice", "personal", service => service.write("note.md", "body"));
  expect(result.state).toBe("published");
  expect(await readFile(join(config.vaultPath, "note.md"), "utf8")).toContain("body");
  await host.routeHost.closeAndDrain();
  await expect(host.routeHost.execute("alice", "personal", service => service.write("late.md", "bad"))).rejects.toMatchObject({ code: "NotReady" });
});

it("disables only for absent configuration and pins initialization failures", async () => {
  expect(await createNodeVaultHostLoader({})()).toBeUndefined();
  await expect(createNodeVaultHostLoader({ OODA_FORGE_VAULT_CONFIG: "" })()).rejects.toThrow("absolute");
  const { path } = await fixture();
  const original = await readFile(path);
  await writeFile(path, "invalid");
  const load = createNodeVaultHostLoader({ OODA_FORGE_VAULT_CONFIG: path });
  await expect(load()).rejects.toThrow();
  await writeFile(path, original);
  await expect(load()).rejects.toThrow();
});

it("rejects lost control state, stale generations and journals inside published content", async () => {
  const { path, config } = await fixture();
  await writeFile(path, JSON.stringify({ ...config, generation: "two" }));
  await expect(loadNodeVaultHost(path)).rejects.toThrow("generation mismatch");
  await writeFile(path, JSON.stringify({ ...config, journalPath: config.vaultPath }));
  await expect(loadNodeVaultHost(path)).rejects.toThrow("control paths");
  await writeFile(path, JSON.stringify(config));
  await rm(config.gatePath);
  await expect(loadNodeVaultHost(path)).rejects.toMatchObject({ code: "ENOENT" });
  await writeFile(config.gatePath, "");
  await expect(loadNodeVaultHost(path)).rejects.toThrow();
});

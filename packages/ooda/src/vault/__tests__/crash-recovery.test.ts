import { expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { ForgePublicationStorage } from "../forge-publication-storage";
import { PublicationJournal } from "../publication-journal";
import { PersistentVaultGate } from "../persistent-vault-gate";

it("recovers a killed publisher's durable intent without dispatching it again", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vault-crash-"));
  const binding = { tenant: "t", actor: "alice", artifact: "vault", generation: "one", repositoryId: "repo" };
  const revision = { objectId: "a".repeat(40), treeId: "b".repeat(40), objectFormat: "sha1" as const };
  const base = new URL("../", import.meta.url);
  const module = (file: string) => JSON.stringify(new URL(file + ".ts", base).href);
  const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
    import {writeFile} from 'node:fs/promises';
    const {ForgePublicationStorage}=await import(${module("forge-publication-storage")});
    const {PublicationJournal}=await import(${module("publication-journal")});
    const {PersistentVaultGate}=await import(${module("persistent-vault-gate")});
    const dir=${JSON.stringify(dir)};
    const storage=new ForgePublicationStorage(${JSON.stringify(binding)},new PublicationJournal(dir+'/journal'),{
      publish:async input=>{
        // A controlled provider records dispatch, then loses its caller before replying.
        await writeFile(dir+'/dispatched.json',JSON.stringify(input),{flag:'wx'});
        console.log('dispatched');
        await new Promise(()=>{setInterval(()=>{},1000)});
      }
    });
    const gate=new PersistentVaultGate(dir+'/gate.sqlite','one');
    await gate.execute(()=>storage.publish({operationId:'crash',ref:'refs/heads/main',expectedHead:null,revision:${JSON.stringify(revision)}}));
  `], { stdio: ["ignore", "pipe", "pipe"] });
  let gate: PersistentVaultGate | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      let output = "";
      child.stdout.on("data", data => { output += data; if (output.includes("dispatched")) resolve(); });
      child.once("error", reject); child.once("exit", code => reject(Error(`Child exited ${code}`)));
    });
    const exit = once(child, "exit"); child.kill("SIGKILL"); await exit;
    gate = new PersistentVaultGate(join(dir, "gate.sqlite"), "one");
    await expect(gate.execute(async () => "new write")).rejects.toMatchObject({ code: "NotReady" });
    const journal = new PublicationJournal(join(dir, "journal"));
    expect((await journal.read("crash"))?.state).toBe("prepared");
    const dispatched = JSON.parse(await readFile(join(dir, "dispatched.json"), "utf8"));
    let sends = 0, acceptance = false;
    const storage = new ForgePublicationStorage(binding, journal, {
      currentRef: async () => "refs/heads/main", resolve: async () => revision,
      commitWorkingTree: async () => revision, remoteHead: async () => ({ reachable: true, head: revision.objectId }),
      publish: async () => { sends++; throw Error("Must not resend"); },
      recover: async input => { expect(input).toEqual(dispatched); return { outcome: acceptance ? "accepted" : "observed" }; },
    });
    expect((await storage.replayPending())[0]?.state).toBe("indeterminate");
    acceptance = true;
    expect((await storage.replayPending())[0]?.state).toBe("published");
    expect(await storage.replayPending()).toEqual([]);
    expect(sends).toBe(0);
    // A recovered receipt alone cannot un-fence the crashed workspace.
    await expect(gate.closeAndDrain(1)).rejects.toThrow("recovery required");
  } finally {
    if (child.exitCode === null && child.signalCode === null) { const exit = once(child, "exit"); child.kill("SIGKILL"); await exit; }
    gate?.dispose();
    await rm(dir, { recursive: true, force: true });
  }
}, 15_000);

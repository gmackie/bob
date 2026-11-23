import { expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { LocalGitStorage } from "@gmacko/ooda/vault";
import { promoteRunnerNote, PendingVaultPromotion, type RunnerVaultPublication } from "../vault-promotion";

it("keeps an uncertain runner promotion pending and gates all local preparation", async () => {
  const root = await mkdtemp(join(tmpdir(), "runner-vault-"));
  try {
    execFileSync("git", ["init", "-b", "main", root], { stdio: "pipe" });
    const local = new LocalGitStorage(root);
    const publish = vi.fn(async (request: any) => ({
      intent: { operationId: "publication", ref: request.ref, expectedHead: request.expectedHead, revision: request.revision, createdAt: new Date().toISOString(), inputDigest: "fixture" },
      state: "indeterminate" as const, attempts: 1, leaseHead: null, updatedAt: new Date().toISOString(),
    }));
    const storage: RunnerVaultPublication["storage"] = {
      capabilities: () => ({ ...local.capabilities(), provider: "forge" }),
      resolve: local.resolve.bind(local), commitWorkingTree: local.commitWorkingTree.bind(local),
      currentRef: local.currentRef.bind(local), remoteHead: async () => ({ reachable: true, head: null }),
      lastObservedRemoteHead: async () => null, replayPending: async () => [], listUnpublished: async () => [], publish,
    };
    let closed = false;
    const admission = {
      async execute<T>(operation: () => Promise<T>) { if (closed) throw Error("closed"); return operation(); },
      async closeAndDrain() { closed = true; },
    };
    const input = { storageRoot: root, threadDir: join(root, "thread"), sessionId: "session", kind: "observation" as const, title: "Result", content: "body", provenance: { capabilityId: "test", operationId: "test", sourceType: "agent" as const, queryOrInputRef: "fixture" } };
    let error: unknown;
    try { await promoteRunnerNote(input, { storage, admission }); } catch (e) { error = e; }
    expect(error).toBeInstanceOf(PendingVaultPromotion);
    expect((error as PendingVaultPromotion).result.publication?.state).toBe("indeterminate");
    expect(publish).toHaveBeenCalledTimes(1);
    const head = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" });
    expect(closed).toBe(true);
    await expect(promoteRunnerNote(input, { storage, admission })).rejects.toThrow("closed");
    expect(execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" })).toBe(head);
    expect(execFileSync("git", ["-C", root, "status", "--porcelain"], { encoding: "utf8" })).toBe("");
    expect(publish).toHaveBeenCalledTimes(1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

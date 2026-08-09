import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import matter from "gray-matter";
import { describe, expect, it } from "vitest";

import { ExternalReceiptV1Schema, type ProposalV1 } from "../../contracts/v1";
import { ObsidianDomainAdapter } from "../obsidian-adapter";

const now = "2026-08-08T20:00:00.000Z";

function proposal(preview: Record<string, unknown>): ProposalV1 {
  return {
    id: "proposal-obsidian-1",
    conversationId: "conversation-1",
    kind: "obsidian_note",
    destination: "obsidian",
    status: "approved",
    risk: "private_write",
    preview,
    rationale: "Promote a curated note after explicit approval.",
    confidence: 0.95,
    policySnapshot: { version: "proposal-policy-v1" },
    version: 2,
    createdAt: now,
    updatedAt: now,
  };
}

describe("ObsidianDomainAdapter", () => {
  it("atomically writes an approved curated note with provenance and replays by idempotency key", async () => {
    const vaultPath = await mkdtemp(join(tmpdir(), "ooda-obsidian-"));
    const adapter = new ObsidianDomainAdapter({
      vaultPath,
      vaultName: "Personal",
    });
    const approved = proposal({
      path: "Captures/2026-08-08 - Voice First OODA.md",
      title: "Voice First OODA",
      content:
        "# Voice First OODA\n\nConnect the conversation to [[Bob]] without creating work automatically.\n",
      frontmatter: {
        date: "2026-08-08",
        type: "conversation-capture",
        tags: ["capture", "ooda"],
      },
    });

    const first = await adapter.commit(approved, "delivery-obsidian-1");
    const replay = await adapter.commit(approved, "delivery-obsidian-1");
    const stored = matter(
      await readFile(
        join(vaultPath, "Captures/2026-08-08 - Voice First OODA.md"),
        "utf8",
      ),
    );

    expect(first).toMatchObject({
      destination: "obsidian",
      externalType: "note",
      externalId: "Captures/2026-08-08 - Voice First OODA.md",
      idempotencyKey: "delivery-obsidian-1",
      status: "completed",
    });
    expect(ExternalReceiptV1Schema.parse(first)).toEqual(first);
    expect(replay).toEqual(first);
    expect(stored.content).toContain("[[Bob]]");
    expect(stored.data).toMatchObject({
      date: "2026-08-08",
      type: "conversation-capture",
      ooda_proposal_id: approved.id,
      ooda_conversation_id: approved.conversationId,
      ooda_idempotency_key: "delivery-obsidian-1",
    });
    await expect(
      adapter.lookupByIdempotencyKey("delivery-obsidian-1"),
    ).resolves.toEqual(first);
  });

  it("rejects traversal, non-curated roots, and overwriting an unrelated note", async () => {
    const vaultPath = await mkdtemp(join(tmpdir(), "ooda-obsidian-"));
    const adapter = new ObsidianDomainAdapter({ vaultPath });
    await expect(
      adapter.validateProposal(
        proposal({ path: "../secret.md", title: "No", content: "No" }),
      ),
    ).resolves.toMatchObject({ valid: false });
    await expect(
      adapter.validateProposal(
        proposal({
          path: "Projects/Unapproved.md",
          title: "No",
          content: "No",
        }),
      ),
    ).resolves.toMatchObject({ valid: false });

    const path = "Areas/Life/Existing.md";
    await mkdir(join(vaultPath, "Areas/Life"), { recursive: true });
    await writeFile(join(vaultPath, path), "# Human note\n", "utf8");
    await expect(
      adapter.commit(
        proposal({ path, title: "Existing", content: "# Replacement\n" }),
        "delivery-collision",
      ),
    ).rejects.toThrow(/already exists/i);
    expect(await readFile(join(vaultPath, path), "utf8")).toBe(
      "# Human note\n",
    );
  });
});

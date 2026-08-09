import { createHash } from "node:crypto";
import { access, readFile as readFsFile } from "node:fs/promises";
import { basename, isAbsolute, resolve } from "node:path";

import matter from "gray-matter";

import type {
  ContextReceipt,
  DomainAdapter,
  ExternalLinkV1,
  ExternalReceiptV1,
  ExternalStatus,
  ProposalV1,
  ValidationReceipt,
} from "../contracts/v1";
import { writeFile as writeVaultFile } from "../vault/writer";

export type ObsidianDomainAdapterConfig = {
  vaultPath: string;
  vaultName?: string;
};

const ALLOWED_ROOTS = ["Captures/", "Areas/", "Resources/Chat Extractions/"];

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function notePath(value: unknown): string | null {
  const path = text(value)?.replaceAll("\\", "/");
  if (
    !path ||
    isAbsolute(path) ||
    path.includes("..") ||
    path.includes("\0") ||
    !path.endsWith(".md") ||
    !ALLOWED_ROOTS.some((root) => path.startsWith(root))
  )
    return null;
  return path;
}

function frontmatter(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

function receiptFile(idempotencyKey: string): string {
  const digest = createHash("sha256").update(idempotencyKey).digest("hex");
  return `.ooda/integration-receipts/obsidian-${digest}.json`;
}

function deepLink(vaultName: string, path: string): string {
  const query = new URLSearchParams({ vault: vaultName, file: path });
  return `obsidian://open?${query.toString()}`;
}

function ensureWithinVault(vaultPath: string, path: string): string {
  const root = resolve(vaultPath);
  const target = resolve(root, path);
  if (!target.startsWith(`${root}/`))
    throw new Error("Obsidian path escapes the vault");
  return target;
}

export class ObsidianDomainAdapter implements DomainAdapter {
  private readonly vaultName: string;

  constructor(private readonly config: ObsidianDomainAdapterConfig) {
    this.vaultName = config.vaultName ?? basename(resolve(config.vaultPath));
  }

  async inspect(input: {
    proposalId?: string;
    externalLinkId?: string;
  }): Promise<ContextReceipt> {
    return {
      destination: "obsidian",
      observedAt: new Date().toISOString(),
      context: {
        ...input,
        vaultName: this.vaultName,
        allowedRoots: ALLOWED_ROOTS,
      },
    };
  }

  async validateProposal(proposal: ProposalV1): Promise<ValidationReceipt> {
    const errors: string[] = [];
    if (proposal.status !== "approved") errors.push("Proposal is not approved");
    if (proposal.destination !== "obsidian")
      errors.push("Proposal destination is not Obsidian");
    if (proposal.kind !== "obsidian_note")
      errors.push("Proposal kind is not an Obsidian note");
    if (!notePath(proposal.preview.path)) {
      errors.push(
        "Note path must be a Markdown file under Captures, Areas, or Resources/Chat Extractions",
      );
    }
    if (!text(proposal.preview.title)) errors.push("Note title is required");
    if (!text(proposal.preview.content))
      errors.push("Note content is required");
    if (
      proposal.preview.frontmatter !== undefined &&
      (!proposal.preview.frontmatter ||
        typeof proposal.preview.frontmatter !== "object" ||
        Array.isArray(proposal.preview.frontmatter))
    ) {
      errors.push("Note frontmatter must be an object");
    }
    return {
      valid: errors.length === 0,
      errors,
      checkedAt: new Date().toISOString(),
    };
  }

  async commit(
    proposal: ProposalV1,
    idempotencyKey: string,
  ): Promise<ExternalReceiptV1> {
    const existingReceipt = await this.lookupByIdempotencyKey(idempotencyKey);
    if (existingReceipt) return existingReceipt;
    const validation = await this.validateProposal(proposal);
    if (!validation.valid) {
      throw new Error(
        `Obsidian proposal validation failed: ${validation.errors.join("; ")}`,
      );
    }
    const path = notePath(proposal.preview.path)!;
    const content = text(proposal.preview.content)!;
    const fullPath = ensureWithinVault(this.config.vaultPath, path);
    const recordedAt = new Date().toISOString();
    const metadata = {
      ...frontmatter(proposal.preview.frontmatter),
      ooda_proposal_id: proposal.id,
      ooda_conversation_id: proposal.conversationId,
      ooda_idempotency_key: idempotencyKey,
      ooda_recorded_at: recordedAt,
      human_reviewed: true,
    };

    try {
      const existing = matter(await readFsFile(fullPath, "utf8"));
      if (existing.data.ooda_idempotency_key !== idempotencyKey) {
        throw new Error(`Obsidian note already exists at ${path}`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await writeVaultFile(this.config.vaultPath, path, content, metadata);
    }

    const receipt: ExternalReceiptV1 = {
      destination: "obsidian",
      externalType: "note",
      externalId: path,
      deepLink: deepLink(this.vaultName, path),
      idempotencyKey,
      status: "completed",
      metadata: {
        path,
        title: text(proposal.preview.title),
        proposalId: proposal.id,
      },
      recordedAt,
    };
    await writeVaultFile(
      this.config.vaultPath,
      receiptFile(idempotencyKey),
      `${JSON.stringify(receipt, null, 2)}\n`,
    );
    return receipt;
  }

  async lookupByIdempotencyKey(
    idempotencyKey: string,
  ): Promise<ExternalReceiptV1 | null> {
    try {
      const raw = await readFsFile(
        ensureWithinVault(this.config.vaultPath, receiptFile(idempotencyKey)),
        "utf8",
      );
      const receipt = JSON.parse(raw) as ExternalReceiptV1;
      return receipt.idempotencyKey === idempotencyKey ? receipt : null;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async readStatus(link: ExternalLinkV1): Promise<ExternalStatus> {
    const path = notePath(link.externalId);
    let present = false;
    if (path) {
      present = await access(ensureWithinVault(this.config.vaultPath, path))
        .then(() => true)
        .catch(() => false);
    }
    return {
      status: present ? "completed" : "missing",
      observedAt: new Date().toISOString(),
      metadata: { path: link.externalId, present },
    };
  }
}

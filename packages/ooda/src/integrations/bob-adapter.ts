import type {
  ContextReceipt,
  DomainAdapter,
  ExternalLinkV1,
  ExternalReceiptV1,
  ExternalStatus,
  ProposalV1,
  ValidationReceipt,
} from "../contracts/v1";

type BobIntakeReceipt = {
  kind: "project" | "work_item";
  id: string;
  key?: string;
  name?: string;
  title?: string;
  status: string;
  replayed: boolean;
};

export type BobDomainAdapterConfig = {
  apiUrl: string;
  apiKey: string;
  workspaceId: string;
};

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is string =>
          typeof item === "string" && Boolean(item.trim()),
      )
    : [];
}

function parseReceipt(value: unknown): BobIntakeReceipt {
  if (!value || typeof value !== "object")
    throw new Error("Bob returned an invalid intake receipt");
  const row = value as Record<string, unknown>;
  if (
    (row.kind !== "project" && row.kind !== "work_item") ||
    typeof row.id !== "string" ||
    typeof row.status !== "string" ||
    typeof row.replayed !== "boolean"
  ) {
    throw new Error("Bob returned an invalid intake receipt");
  }
  return row as BobIntakeReceipt;
}

export class BobDomainAdapter implements DomainAdapter {
  private readonly baseUrl: string;

  constructor(private readonly config: BobDomainAdapterConfig) {
    this.baseUrl = config.apiUrl.replace(/\/+$/, "");
  }

  async inspect(input: {
    proposalId?: string;
    externalLinkId?: string;
  }): Promise<ContextReceipt> {
    return {
      destination: "bob",
      observedAt: new Date().toISOString(),
      context: { ...input, workspaceId: this.config.workspaceId },
    };
  }

  async validateProposal(proposal: ProposalV1): Promise<ValidationReceipt> {
    const errors: string[] = [];
    if (proposal.status !== "approved") errors.push("Proposal is not approved");
    if (proposal.destination !== "bob")
      errors.push("Proposal destination is not Bob");
    if (proposal.kind !== "bob_project" && proposal.kind !== "bob_task") {
      errors.push("Proposal kind is not supported by Bob");
    }
    const title = text(
      proposal.kind === "bob_project"
        ? proposal.preview.name
        : proposal.preview.title,
    );
    if (!title) errors.push("Proposal title is required");
    if (stringList(proposal.preview.acceptanceCriteria).length === 0) {
      errors.push("At least one acceptance criterion is required");
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
    const validation = await this.validateProposal(proposal);
    if (!validation.valid)
      throw new Error(
        `Bob proposal validation failed: ${validation.errors.join("; ")}`,
      );
    const isProject = proposal.kind === "bob_project";
    const preview = proposal.preview;
    const body = {
      workspaceId: this.config.workspaceId,
      ...(isProject
        ? {
            name: text(preview.name),
            tasks: stringList(preview.tasks),
          }
        : {
            title: text(preview.title),
            projectId: text(preview.projectId),
          }),
      description: text(preview.description),
      acceptanceCriteria: stringList(preview.acceptanceCriteria),
      idempotencyKey,
      source: {
        system: "ooda",
        proposalId: proposal.id,
        conversationId: proposal.conversationId,
        proposalVersion: proposal.version,
        rationale: proposal.rationale,
        confidence: proposal.confidence,
        policySnapshot: proposal.policySnapshot,
        targetRepo: text(preview.targetRepo),
        constraints: stringList(preview.constraints),
        nonGoals: stringList(preview.nonGoals),
        researchEvidence: preview.researchEvidence,
        uncertainty: preview.uncertainty,
      },
    };
    const response = await fetch(
      `${this.baseUrl}/api/v1/${isProject ? "projects" : "tasks"}`,
      {
        method: "POST",
        headers: this.headers(idempotencyKey),
        body: JSON.stringify(body),
      },
    );
    if (!response.ok) throw await this.responseError("commit", response);
    return this.toExternalReceipt(
      parseReceipt(await response.json()),
      idempotencyKey,
    );
  }

  async lookupByIdempotencyKey(key: string): Promise<ExternalReceiptV1 | null> {
    const query = new URLSearchParams({
      idempotencyKey: key,
      workspaceId: this.config.workspaceId,
    });
    const response = await fetch(`${this.baseUrl}/api/v1/intakes?${query}`, {
      method: "GET",
      headers: this.headers(),
    });
    if (response.status === 404) return null;
    if (!response.ok) throw await this.responseError("lookup", response);
    return this.toExternalReceipt(parseReceipt(await response.json()), key);
  }

  async readStatus(link: ExternalLinkV1): Promise<ExternalStatus> {
    const receipt = await this.lookupByIdempotencyKey(link.idempotencyKey);
    return {
      status: receipt?.status ?? "missing",
      observedAt: new Date().toISOString(),
      metadata: receipt?.metadata ?? {},
    };
  }

  private headers(idempotencyKey?: string): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.config.apiKey}`,
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    };
  }

  private toExternalReceipt(
    receipt: BobIntakeReceipt,
    idempotencyKey: string,
  ): ExternalReceiptV1 {
    const path = receipt.kind === "project" ? "projects" : "work-items";
    return {
      destination: "bob",
      externalType: receipt.kind,
      externalId: receipt.id,
      deepLink: `${this.baseUrl}/${path}/${encodeURIComponent(receipt.id)}`,
      idempotencyKey,
      status: receipt.status === "completed" ? "completed" : "accepted",
      metadata: {
        status: receipt.status,
        replayed: receipt.replayed,
        ...(receipt.key ? { key: receipt.key } : {}),
        ...(receipt.name ? { name: receipt.name } : {}),
        ...(receipt.title ? { title: receipt.title } : {}),
      },
      recordedAt: new Date().toISOString(),
    };
  }

  private async responseError(
    operation: string,
    response: Response,
  ): Promise<Error> {
    const detail = (await response.text().catch(() => "")).slice(0, 1_000);
    return new Error(
      `Bob ${operation} failed (${response.status})${detail ? `: ${detail}` : ""}`,
    );
  }
}

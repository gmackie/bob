import type {
  ContextReceipt,
  DomainAdapter,
  ExternalLinkV1,
  ExternalReceiptV1,
  ExternalStatus,
  ProposalV1,
  ValidationReceipt,
} from "../contracts/v1";

export type BizPulseStartup = {
  id: string;
  name: string;
  slug: string;
  portfolioRole: string;
  lifecycleStage: string;
  operatorNotes?: string | null;
  createdAt: string;
};

export type BizPulseCreateStartupInput = {
  name: string;
  slug: string;
  portfolioRole: "incubating";
  lifecycleStage: "idea";
  ownershipModel: "gmacko_owned";
  managingEntityName: "Gmacko LLC";
  operatorNotes: string;
};

export interface BizPulseClient {
  listStartups(): Promise<BizPulseStartup[]>;
  getStartupBySlug(slug: string): Promise<BizPulseStartup | null>;
  createStartup(input: BizPulseCreateStartupInput): Promise<BizPulseStartup>;
}

export type BizPulseDomainAdapterConfig = {
  apiUrl: string;
  client: BizPulseClient;
};

const REQUIRED_TEXT_FIELDS = [
  "name",
  "opportunityReviewId",
  "problem",
  "audience",
  "currentWorkaround",
  "differentiation",
  "strategicFit",
  "smallestTest",
  "effort",
] as const;

const REQUIRED_LIST_FIELDS = ["evidence", "risks", "killCriteria"] as const;

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

function slugify(value: string): string {
  const slug = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100)
    .replace(/-+$/g, "");
  if (!slug) throw new Error("BizPulse venture name cannot produce a slug");
  return slug;
}

function idempotencyMarker(key: string): string {
  return `OODA_IDEMPOTENCY_KEY: ${key}`;
}

function notes(proposal: ProposalV1, idempotencyKey: string): string {
  const preview = proposal.preview;
  const value = [
    `OODA_PROPOSAL_ID: ${proposal.id}`,
    idempotencyMarker(idempotencyKey),
    `OODA_CONVERSATION_ID: ${proposal.conversationId}`,
    `OODA_OPPORTUNITY_REVIEW_ID: ${text(preview.opportunityReviewId)}`,
    "",
    `Problem: ${text(preview.problem)}`,
    `Smallest test: ${text(preview.smallestTest)}`,
    `Kill criteria: ${stringList(preview.killCriteria).join("; ")}`,
  ].join("\n");
  return value.slice(0, 2_000);
}

export class BizPulseDomainAdapter implements DomainAdapter {
  private readonly baseUrl: string;

  constructor(private readonly config: BizPulseDomainAdapterConfig) {
    this.baseUrl = config.apiUrl.replace(/\/+$/, "");
  }

  async inspect(input: {
    proposalId?: string;
    externalLinkId?: string;
  }): Promise<ContextReceipt> {
    return {
      destination: "bizpulse",
      observedAt: new Date().toISOString(),
      context: {
        ...input,
        lifecycleStage: "idea",
        portfolioRole: "incubating",
      },
    };
  }

  async validateProposal(proposal: ProposalV1): Promise<ValidationReceipt> {
    const errors: string[] = [];
    if (proposal.status !== "approved") errors.push("Proposal is not approved");
    if (proposal.destination !== "bizpulse")
      errors.push("Proposal destination is not BizPulse");
    if (proposal.kind !== "bizpulse_venture")
      errors.push("Proposal kind is not a BizPulse venture");
    for (const field of REQUIRED_TEXT_FIELDS) {
      if (!text(proposal.preview[field])) errors.push(`${field} is required`);
    }
    for (const field of REQUIRED_LIST_FIELDS) {
      if (stringList(proposal.preview[field]).length === 0)
        errors.push(`${field} requires at least one item`);
    }
    if (
      proposal.preview.slug !== undefined &&
      (!text(proposal.preview.slug) ||
        text(proposal.preview.slug)!.length > 100 ||
        !/^[a-z0-9-]+$/.test(text(proposal.preview.slug)!))
    ) {
      errors.push(
        "slug must contain only lowercase letters, digits, and hyphens",
      );
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
    const replay = await this.lookupByIdempotencyKey(idempotencyKey);
    if (replay) return replay;
    const validation = await this.validateProposal(proposal);
    if (!validation.valid) {
      throw new Error(
        `BizPulse proposal validation failed: ${validation.errors.join("; ")}`,
      );
    }

    const name = text(proposal.preview.name)!;
    const slug = text(proposal.preview.slug) ?? slugify(name);
    const existing = await this.config.client.getStartupBySlug(slug);
    if (existing) {
      if (existing.operatorNotes?.includes(idempotencyMarker(idempotencyKey)))
        return this.receipt(existing, idempotencyKey);
      throw new Error(`BizPulse venture slug already exists: ${slug}`);
    }

    const input: BizPulseCreateStartupInput = {
      name,
      slug,
      portfolioRole: "incubating",
      lifecycleStage: "idea",
      ownershipModel: "gmacko_owned",
      managingEntityName: "Gmacko LLC",
      operatorNotes: notes(proposal, idempotencyKey),
    };
    try {
      const created = await this.config.client.createStartup(input);
      return this.receipt(created, idempotencyKey);
    } catch (error) {
      const reconciled = await this.lookupByIdempotencyKey(idempotencyKey);
      if (reconciled) return reconciled;
      throw error;
    }
  }

  async lookupByIdempotencyKey(key: string): Promise<ExternalReceiptV1 | null> {
    const marker = idempotencyMarker(key);
    const startup = (await this.config.client.listStartups()).find((item) =>
      item.operatorNotes?.includes(marker),
    );
    return startup ? this.receipt(startup, key) : null;
  }

  async readStatus(link: ExternalLinkV1): Promise<ExternalStatus> {
    const startup = (await this.config.client.listStartups()).find(
      (item) => item.id === link.externalId,
    );
    return {
      status: startup ? startup.lifecycleStage : "missing",
      observedAt: new Date().toISOString(),
      metadata: startup
        ? {
            name: startup.name,
            slug: startup.slug,
            portfolioRole: startup.portfolioRole,
          }
        : { externalId: link.externalId },
    };
  }

  private receipt(
    startup: BizPulseStartup,
    idempotencyKey: string,
  ): ExternalReceiptV1 {
    return {
      destination: "bizpulse",
      externalType: "venture",
      externalId: startup.id,
      deepLink: `${this.baseUrl}/dashboard/startup/${encodeURIComponent(startup.id)}`,
      idempotencyKey,
      status: "accepted",
      metadata: {
        name: startup.name,
        slug: startup.slug,
        lifecycleStage: startup.lifecycleStage,
        portfolioRole: startup.portfolioRole,
      },
      recordedAt: startup.createdAt,
    };
  }
}

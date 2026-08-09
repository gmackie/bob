import type {
  ContextReceipt,
  DomainAdapter,
  ExternalLinkV1,
  ExternalReceiptV1,
  ExternalStatus,
  ProposalV1,
  ValidationReceipt,
} from "../contracts/v1";

const DESTINATION_OWNED_FIELD =
  /^(device|devices|deviceId|station|stations|stationId|testEvidence|testRun|testRunId|evidence|firmwareBuild|releaseApproved|releaseDecision|campaign|waiver|rollout)$/i;

export type VeritasProject = {
  id: string;
  orgId: string;
  name: string;
  slug: string;
  description?: string | null;
  firmwareRepoUrl: string;
  pcbRepoUrl?: string | null;
  targetHardware?: string | null;
  autoValidate: boolean;
  createdAt: string;
  updatedAt: string;
};

export type VeritasProjectInput = {
  name: string;
  slug: string;
  description?: string;
  firmwareRepoUrl: string;
  pcbRepoUrl?: string;
  targetHardware?: string;
};

export interface VeritasClient {
  listProjects(search?: string): Promise<VeritasProject[]>;
  getProject(id: string): Promise<VeritasProject | null>;
  createProject(input: VeritasProjectInput): Promise<VeritasProject>;
}

export type VeritasDomainAdapterConfig = {
  apiUrl: string;
  client: VeritasClient;
};

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isHttpUrl(value: unknown): boolean {
  const candidate = text(value);
  if (!candidate) return false;
  try {
    const url = new URL(candidate);
    return (
      (url.protocol === "https:" || url.protocol === "http:") &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

function safeKey(idempotencyKey: string): string {
  return idempotencyKey.replace(/\s+/g, " ").trim();
}

function deliveryMarker(idempotencyKey: string): string {
  return `OODA delivery: ${safeKey(idempotencyKey)}`;
}

function projectSlug(idempotencyKey: string): string {
  const normalized = safeKey(idempotencyKey)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 59);
  if (!normalized)
    throw new Error("Veritas delivery idempotency key is invalid");
  return `ooda-${normalized}`;
}

export class VeritasDomainAdapter implements DomainAdapter {
  private readonly baseUrl: string;

  constructor(private readonly config: VeritasDomainAdapterConfig) {
    this.baseUrl = config.apiUrl.replace(/\/+$/, "");
  }

  async inspect(input: {
    proposalId?: string;
    externalLinkId?: string;
  }): Promise<ContextReceipt> {
    const projects = await this.config.client.listProjects();
    return {
      destination: "veritas",
      observedAt: new Date().toISOString(),
      context: {
        ...input,
        projectCount: projects.length,
        autoValidationCount: projects.filter((project) => project.autoValidate)
          .length,
      },
    };
  }

  async validateProposal(proposal: ProposalV1): Promise<ValidationReceipt> {
    const errors: string[] = [];
    const preview = proposal.preview;
    if (proposal.status !== "approved") errors.push("Proposal is not approved");
    if (proposal.destination !== "veritas")
      errors.push("Proposal destination is not Veritas");
    if (proposal.kind !== "hardware_validation")
      errors.push("Proposal kind is not hardware validation");
    if (!text(preview.name)) errors.push("name is required");
    if (!isHttpUrl(preview.firmwareRepoUrl))
      errors.push("firmwareRepoUrl must be an HTTP(S) URL without credentials");
    if (preview.pcbRepoUrl !== undefined && !isHttpUrl(preview.pcbRepoUrl)) {
      errors.push("pcbRepoUrl must be an HTTP(S) URL without credentials");
    }
    if (Object.keys(preview).some((key) => DESTINATION_OWNED_FIELD.test(key))) {
      errors.push(
        "Destination-owned device, station, evidence, and release-approval fields are not allowed in OODA intake",
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
        `Veritas proposal validation failed: ${validation.errors.join("; ")}`,
      );
    }

    const slug = projectSlug(idempotencyKey);
    const collision = (await this.config.client.listProjects(slug)).find(
      (project) => project.slug === slug,
    );
    if (collision) {
      throw new Error(
        `Veritas project slug collision: ${slug} is not owned by this delivery`,
      );
    }

    const preview = proposal.preview;
    const description = [
      text(preview.description),
      `OODA proposal: ${proposal.id}`,
      deliveryMarker(idempotencyKey),
    ]
      .filter(Boolean)
      .join("\n\n");
    const project = await this.config.client.createProject({
      name: text(preview.name)!,
      slug,
      description,
      firmwareRepoUrl: text(preview.firmwareRepoUrl)!,
      ...(text(preview.pcbRepoUrl)
        ? { pcbRepoUrl: text(preview.pcbRepoUrl) }
        : {}),
      ...(text(preview.targetHardware)
        ? { targetHardware: text(preview.targetHardware) }
        : {}),
    });
    if (
      project.slug !== slug ||
      !project.description?.includes(deliveryMarker(idempotencyKey))
    ) {
      throw new Error(
        "Veritas returned a project identity that cannot be reconciled safely",
      );
    }
    return this.receipt(project, idempotencyKey);
  }

  async lookupByIdempotencyKey(
    idempotencyKey: string,
  ): Promise<ExternalReceiptV1 | null> {
    const slug = projectSlug(idempotencyKey);
    const marker = deliveryMarker(idempotencyKey);
    const project = (await this.config.client.listProjects(slug)).find(
      (candidate) =>
        candidate.slug === slug && candidate.description?.includes(marker),
    );
    return project ? this.receipt(project, idempotencyKey) : null;
  }

  async readStatus(link: ExternalLinkV1): Promise<ExternalStatus> {
    const project = await this.config.client.getProject(link.externalId);
    return {
      status: project ? "registered" : "missing",
      observedAt: new Date().toISOString(),
      metadata: project
        ? {
            name: project.name,
            slug: project.slug,
            firmwareRepoUrl: project.firmwareRepoUrl,
            targetHardware: project.targetHardware,
            autoValidate: project.autoValidate,
          }
        : { externalId: link.externalId },
    };
  }

  private receipt(
    project: VeritasProject,
    idempotencyKey: string,
  ): ExternalReceiptV1 {
    return {
      destination: "veritas",
      externalType: "hardware_project",
      externalId: project.id,
      deepLink: `${this.baseUrl}/projects/${encodeURIComponent(project.id)}`,
      idempotencyKey,
      status: "accepted",
      metadata: {
        name: project.name,
        slug: project.slug,
        firmwareRepoUrl: project.firmwareRepoUrl,
        targetHardware: project.targetHardware,
        autoValidate: project.autoValidate,
      },
      recordedAt: project.createdAt,
    };
  }
}

import type {
  ContextReceipt,
  DomainAdapter,
  ExternalLinkV1,
  ExternalReceiptV1,
  ExternalStatus,
  ProposalV1,
  ValidationReceipt,
} from "../contracts/v1";

const PROCESS_TYPES = new Set([
  "three_d_print",
  "laser_cut",
  "cnc",
  "sewing",
  "pcb_fabrication",
  "pcb_assembly",
  "pick_and_place",
  "inspection",
  "external_service",
  "manual",
  "other",
]);
const TARGET_TYPES = new Set([
  "source_file",
  "manifest",
  "release_package",
  "manual",
]);
const GROUPING_STRATEGIES = new Set([
  "manifest",
  "source_file",
  "directory",
  "release_package",
  "manual",
]);
const PHYSICAL_EXECUTION_FIELD =
  /prepared|dispatch|approve|purchase|submit|machine|device|startProduction/i;

export type FabForgeWorkOrder = {
  id: string;
  workspaceId: string;
  title: string;
  description?: string | null;
  status: string;
  repositoryId?: string | null;
  manualSourceKey?: string | null;
  targetType: string;
  groupingKey: string;
  processTypes: string[];
  manifestPath?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type FabForgeCandidateWorkOrderInput = {
  workspaceId: string;
  repositoryId?: string | null;
  manualSourceKey: string;
  title: string;
  description?: string | null;
  status: "candidate";
  targetType: "source_file" | "manifest" | "release_package" | "manual";
  targetRef?: unknown;
  sourceFileRefs?: unknown[];
  processTypes?: string[];
  groupingStrategy:
    | "manifest"
    | "source_file"
    | "directory"
    | "release_package"
    | "manual";
  groupingKey: string;
  manifestPath?: string | null;
};

export interface FabForgeClient {
  listWorkOrders(workspaceId: string): Promise<FabForgeWorkOrder[]>;
  createCandidateWorkOrder(
    input: FabForgeCandidateWorkOrderInput,
  ): Promise<{ created: boolean; workOrder: FabForgeWorkOrder }>;
}

export type FabForgeDomainAdapterConfig = {
  apiUrl: string;
  workspaceId: string;
  client: FabForgeClient;
};

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is string =>
          typeof item === "string" && Boolean(item.trim()),
      )
    : [];
}

function sourceKey(idempotencyKey: string): string {
  return `ooda:${idempotencyKey}`;
}

export class FabForgeDomainAdapter implements DomainAdapter {
  private readonly baseUrl: string;

  constructor(private readonly config: FabForgeDomainAdapterConfig) {
    this.baseUrl = config.apiUrl.replace(/\/+$/, "");
  }

  async inspect(input: {
    proposalId?: string;
    externalLinkId?: string;
  }): Promise<ContextReceipt> {
    const workOrders = await this.config.client.listWorkOrders(
      this.config.workspaceId,
    );
    return {
      destination: "fabforge",
      observedAt: new Date().toISOString(),
      context: {
        ...input,
        workspaceId: this.config.workspaceId,
        candidateCount: workOrders.filter(
          (workOrder) => workOrder.status === "candidate",
        ).length,
        blockedCount: workOrders.filter(
          (workOrder) => workOrder.status === "blocked",
        ).length,
      },
    };
  }

  async validateProposal(proposal: ProposalV1): Promise<ValidationReceipt> {
    const errors: string[] = [];
    const preview = proposal.preview;
    if (proposal.status !== "approved") errors.push("Proposal is not approved");
    if (proposal.destination !== "fabforge")
      errors.push("Proposal destination is not FabForge");
    if (proposal.kind !== "fabrication_project")
      errors.push("Proposal kind is not a fabrication project");
    if (!text(preview.title)) errors.push("title is required");
    if (!TARGET_TYPES.has(text(preview.targetType) ?? "")) {
      errors.push("targetType is invalid");
    }
    if (!GROUPING_STRATEGIES.has(text(preview.groupingStrategy) ?? "")) {
      errors.push("groupingStrategy is invalid");
    }
    if (!text(preview.groupingKey)) errors.push("groupingKey is required");
    const processTypes = stringArray(preview.processTypes);
    if (processTypes.some((processType) => !PROCESS_TYPES.has(processType))) {
      errors.push("processTypes contains an unsupported process");
    }
    if (preview.status !== undefined && preview.status !== "candidate") {
      errors.push("FabForge intake must start as a candidate");
    }
    if (
      Object.keys(preview).some((key) => PHYSICAL_EXECUTION_FIELD.test(key))
    ) {
      errors.push(
        "Physical execution and prepared-action fields are not allowed in OODA intake",
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
        `FabForge proposal validation failed: ${validation.errors.join("; ")}`,
      );
    }
    const preview = proposal.preview;
    const result = await this.config.client.createCandidateWorkOrder({
      workspaceId: this.config.workspaceId,
      manualSourceKey: sourceKey(idempotencyKey),
      title: text(preview.title)!,
      status: "candidate",
      targetType: text(
        preview.targetType,
      )! as FabForgeCandidateWorkOrderInput["targetType"],
      groupingStrategy: text(
        preview.groupingStrategy,
      )! as FabForgeCandidateWorkOrderInput["groupingStrategy"],
      groupingKey: text(preview.groupingKey)!,
      ...(text(preview.description)
        ? { description: text(preview.description) }
        : {}),
      ...(text(preview.repositoryId)
        ? { repositoryId: text(preview.repositoryId) }
        : {}),
      ...(preview.targetRef !== undefined
        ? { targetRef: preview.targetRef }
        : {}),
      ...(Array.isArray(preview.sourceFileRefs)
        ? { sourceFileRefs: preview.sourceFileRefs }
        : {}),
      ...(stringArray(preview.processTypes).length
        ? { processTypes: stringArray(preview.processTypes) }
        : {}),
      ...(text(preview.manifestPath)
        ? { manifestPath: text(preview.manifestPath) }
        : {}),
    });
    return this.receipt(result.workOrder, idempotencyKey);
  }

  async lookupByIdempotencyKey(key: string): Promise<ExternalReceiptV1 | null> {
    const marker = sourceKey(key);
    const workOrder = (
      await this.config.client.listWorkOrders(this.config.workspaceId)
    ).find((candidate) => candidate.manualSourceKey === marker);
    return workOrder ? this.receipt(workOrder, key) : null;
  }

  async readStatus(link: ExternalLinkV1): Promise<ExternalStatus> {
    const workOrder = (
      await this.config.client.listWorkOrders(this.config.workspaceId)
    ).find((candidate) => candidate.id === link.externalId);
    return {
      status: workOrder?.status ?? "missing",
      observedAt: new Date().toISOString(),
      metadata: workOrder
        ? {
            title: workOrder.title,
            repositoryId: workOrder.repositoryId,
            processTypes: workOrder.processTypes,
          }
        : { externalId: link.externalId },
    };
  }

  private receipt(
    workOrder: FabForgeWorkOrder,
    idempotencyKey: string,
  ): ExternalReceiptV1 {
    const query = new URLSearchParams({
      workspaceId: this.config.workspaceId,
      workOrderId: workOrder.id,
    });
    return {
      destination: "fabforge",
      externalType: "fabrication_work_order",
      externalId: workOrder.id,
      deepLink: `${this.baseUrl}/fabrication?${query}`,
      idempotencyKey,
      status: workOrder.status === "complete" ? "completed" : "accepted",
      metadata: {
        title: workOrder.title,
        status: workOrder.status,
        repositoryId: workOrder.repositoryId,
        processTypes: workOrder.processTypes,
        groupingKey: workOrder.groupingKey,
      },
      recordedAt: workOrder.createdAt,
    };
  }
}

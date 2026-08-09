import { createHash, randomUUID } from "node:crypto";
import {
  access,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import type {
  ContextReceipt,
  DomainAdapter,
  ExternalLinkV1,
  ExternalReceiptV1,
  ExternalStatus,
  ProposalV1,
  ValidationReceipt,
} from "../contracts/v1";

export type CreatorProject = {
  id: string;
  manifestId?: string | null;
  sourceKind: "local" | "github";
  sourcePath?: string | null;
  githubOwner?: string | null;
  githubRepo?: string | null;
  gitRef?: string | null;
  title?: string | null;
  status: string;
  createdAt?: string | null;
};

export interface CreatorClient {
  listProjects(): Promise<CreatorProject[]>;
  registerLocalProject(projectPath: string): Promise<CreatorProject>;
}

export type CreatorScaffoldInput = {
  projectPath: string;
  title: string;
  format: "long" | "short" | "stream";
  audience: string;
  promise: string;
  fabforgeProject?: string;
};

export type CreatorProjectScaffolder = (
  input: CreatorScaffoldInput,
) => Promise<void>;

export type CreatorDomainAdapterConfig = {
  apiUrl: string;
  projectRoot: string;
  receiptRoot: string;
  client: CreatorClient;
  scaffold: CreatorProjectScaffolder;
};

type CreatorManifest = {
  id: string;
  title: string;
  format: "long" | "short" | "stream";
  status: string;
  sources?: Array<{ kind?: unknown; project?: unknown; units?: unknown }>;
  facts?: unknown;
};

const VIDEO_FORMATS = new Set(["long", "short", "stream"]);

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isWithin(root: string, target: string): boolean {
  const path = relative(root, target);
  return (
    path !== "" &&
    path !== ".." &&
    !path.startsWith(`..${sep}`) &&
    !isAbsolute(path)
  );
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

async function containedProjectPath(
  projectRoot: string,
  requestedPath: string,
): Promise<string> {
  const lexicalRoot = resolve(projectRoot);
  const target = resolve(requestedPath);
  if (!isWithin(lexicalRoot, target)) {
    throw new Error(
      "Creator project path must be inside the configured project root",
    );
  }
  const root = await realpath(projectRoot).catch(() => {
    throw new Error("Creator project root does not exist");
  });

  let ancestor = target;
  while (!(await exists(ancestor))) {
    const parent = dirname(ancestor);
    if (parent === ancestor) break;
    ancestor = parent;
  }
  const resolvedAncestor = await realpath(ancestor);
  if (resolvedAncestor !== root && !isWithin(root, resolvedAncestor)) {
    throw new Error("Creator project path escapes the configured project root");
  }
  if (await exists(target)) {
    const resolvedTarget = await realpath(target);
    if (!isWithin(root, resolvedTarget)) {
      throw new Error(
        "Creator project path escapes the configured project root",
      );
    }
    return resolvedTarget;
  }
  return target;
}

function receiptFilename(key: string): string {
  return `${createHash("sha256").update(key).digest("hex")}.json`;
}

function parseManifest(value: string): CreatorManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Creator video.project.json is not valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Creator video.project.json must be an object");
  }
  const row = parsed as Record<string, unknown>;
  const id = text(row.id);
  const title = text(row.title);
  const format = text(row.format);
  const status = text(row.status);
  if (!id || !title || !format || !VIDEO_FORMATS.has(format) || !status) {
    throw new Error(
      "Creator video.project.json is missing its required identity",
    );
  }
  return row as CreatorManifest;
}

function approvedInput(
  proposal: ProposalV1,
  projectPath: string,
): CreatorScaffoldInput {
  const preview = proposal.preview;
  return {
    projectPath,
    title: text(preview.title)!,
    format: text(preview.format)! as CreatorScaffoldInput["format"],
    audience: text(preview.audience)!,
    promise: text(preview.promise)!,
    ...(text(preview.fabforgeProject)
      ? { fabforgeProject: text(preview.fabforgeProject) }
      : {}),
  };
}

function verifyManifest(
  manifest: CreatorManifest,
  input: CreatorScaffoldInput,
): void {
  if (manifest.title !== input.title || manifest.format !== input.format) {
    throw new Error(
      "Existing Creator manifest does not match the approved preview",
    );
  }
  if (manifest.facts !== undefined) {
    throw new Error("Creator manifests cannot copy derived FabForge facts");
  }
  const fabforgeSources = (manifest.sources ?? []).filter(
    (source) => source.kind === "fabforge",
  );
  if (input.fabforgeProject) {
    if (
      fabforgeSources.length !== 1 ||
      fabforgeSources[0]?.project !== input.fabforgeProject ||
      !Array.isArray(fabforgeSources[0]?.units)
    ) {
      throw new Error(
        "Creator manifest must preserve FabForge as an unresolved pointer",
      );
    }
  } else if (fabforgeSources.length > 0) {
    throw new Error("Creator manifest contains an unapproved FabForge source");
  }
}

export class CreatorDomainAdapter implements DomainAdapter {
  private readonly baseUrl: string;

  constructor(private readonly config: CreatorDomainAdapterConfig) {
    this.baseUrl = config.apiUrl.replace(/\/+$/, "");
  }

  async inspect(input: {
    proposalId?: string;
    externalLinkId?: string;
  }): Promise<ContextReceipt> {
    const projects = await this.config.client.listProjects();
    return {
      destination: "creator",
      observedAt: new Date().toISOString(),
      context: {
        ...input,
        projectCount: projects.length,
        statuses: projects.reduce<Record<string, number>>((counts, project) => {
          counts[project.status] = (counts[project.status] ?? 0) + 1;
          return counts;
        }, {}),
      },
    };
  }

  async validateProposal(proposal: ProposalV1): Promise<ValidationReceipt> {
    const errors: string[] = [];
    if (proposal.status !== "approved") errors.push("Proposal is not approved");
    if (proposal.destination !== "creator")
      errors.push("Proposal destination is not Creator");
    if (proposal.kind !== "content_project")
      errors.push("Proposal kind is not a content project");
    const projectPath = text(proposal.preview.projectPath);
    if (!projectPath || !isAbsolute(projectPath)) {
      errors.push("An absolute projectPath is required");
    } else {
      await containedProjectPath(this.config.projectRoot, projectPath).catch(
        (error: unknown) =>
          errors.push(error instanceof Error ? error.message : String(error)),
      );
    }
    if (!text(proposal.preview.title)) errors.push("title is required");
    if (!VIDEO_FORMATS.has(text(proposal.preview.format) ?? "")) {
      errors.push("format must be long, short, or stream");
    }
    if (!text(proposal.preview.audience)) errors.push("audience is required");
    if (!text(proposal.preview.promise)) errors.push("promise is required");
    if (Object.keys(proposal.preview).some((key) => /facts/i.test(key))) {
      errors.push("Derived FabForge facts cannot be copied into Creator");
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
        `Creator proposal validation failed: ${validation.errors.join("; ")}`,
      );
    }

    const projectPath = await containedProjectPath(
      this.config.projectRoot,
      text(proposal.preview.projectPath)!,
    );
    const input = approvedInput(proposal, projectPath);
    const existing = await this.findProject(projectPath);
    const manifestPath = join(projectPath, "video.project.json");
    if (!(await exists(manifestPath))) {
      if (existing) {
        throw new Error(
          "Creator registration exists but video.project.json is missing",
        );
      }
      if (await exists(projectPath)) {
        const entries = await readdir(projectPath);
        if (entries.length > 0) {
          throw new Error(
            "Creator project directory is not empty and has no video.project.json",
          );
        }
      }
      await this.config.scaffold(input);
    }
    const manifest = parseManifest(await readFile(manifestPath, "utf8"));
    verifyManifest(manifest, input);
    if (existing) {
      const receipt = this.receipt(existing, idempotencyKey);
      await this.storeReceipt(receipt);
      return receipt;
    }

    let created: CreatorProject;
    try {
      created = await this.config.client.registerLocalProject(projectPath);
    } catch (error) {
      const reconciled = await this.findProject(projectPath);
      if (!reconciled) throw error;
      created = reconciled;
    }
    if (created.manifestId && created.manifestId !== manifest.id) {
      throw new Error("Creator registered a different manifest identity");
    }
    const receipt = this.receipt(created, idempotencyKey);
    await this.storeReceipt(receipt);
    return receipt;
  }

  async lookupByIdempotencyKey(key: string): Promise<ExternalReceiptV1 | null> {
    const path = join(this.config.receiptRoot, receiptFilename(key));
    if (!(await exists(path))) return null;
    const parsed = JSON.parse(
      await readFile(path, "utf8"),
    ) as ExternalReceiptV1;
    return parsed.idempotencyKey === key && parsed.destination === "creator"
      ? parsed
      : null;
  }

  async readStatus(link: ExternalLinkV1): Promise<ExternalStatus> {
    const project = (await this.config.client.listProjects()).find(
      (candidate) => candidate.id === link.externalId,
    );
    return {
      status: project?.status ?? "missing",
      observedAt: new Date().toISOString(),
      metadata: project
        ? {
            manifestId: project.manifestId,
            title: project.title,
            sourceKind: project.sourceKind,
          }
        : { externalId: link.externalId },
    };
  }

  private async findProject(
    projectPath: string,
  ): Promise<CreatorProject | null> {
    const normalized = resolve(projectPath);
    return (
      (await this.config.client.listProjects()).find(
        (project) =>
          project.sourceKind === "local" &&
          project.sourcePath !== null &&
          project.sourcePath !== undefined &&
          resolve(project.sourcePath) === normalized,
      ) ?? null
    );
  }

  private receipt(
    project: CreatorProject,
    idempotencyKey: string,
  ): ExternalReceiptV1 {
    return {
      destination: "creator",
      externalType: "video_project",
      externalId: project.id,
      deepLink: `${this.baseUrl}/videos/${encodeURIComponent(project.id)}`,
      idempotencyKey,
      status: project.status === "published" ? "completed" : "accepted",
      metadata: {
        manifestId: project.manifestId,
        title: project.title,
        status: project.status,
        sourceKind: project.sourceKind,
      },
      recordedAt: project.createdAt ?? new Date().toISOString(),
    };
  }

  private async storeReceipt(receipt: ExternalReceiptV1): Promise<void> {
    await mkdir(this.config.receiptRoot, { recursive: true });
    const path = join(
      this.config.receiptRoot,
      receiptFilename(receipt.idempotencyKey),
    );
    const temporary = `${path}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(receipt)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporary, path);
  }
}

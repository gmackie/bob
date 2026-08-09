import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

import {
  ExternalReceiptV1Schema,
  type ContextReceipt,
  type DomainAdapter,
  type ExternalLinkV1,
  type ExternalReceiptV1,
  type ExternalStatus,
  type ProposalV1,
  type ValidationReceipt,
} from "../contracts/v1";

const APP_RUNTIMES = new Set(["expo", "unity"]);
const DISTRIBUTION_INTENTS = new Set(["internal_only", "store_bound"]);
const OPERATIONAL_RELEASE_FIELD =
  /^(build|buildId|queueBuild|workflow|workflowId|launch|launchId|submit|submitRelease|submission|publish|releaseApproval|credentials|credential|secret|storeListing)$/i;

export type PreflightApp = {
  id: string;
  workspaceId: string;
  forgeGraphAppId?: string;
  appRuntime?: "expo" | "unity";
  displayName?: string;
  packageName: string;
  packagePath: string;
  expoSlug?: string;
  iosBundleId?: string;
  androidPackage?: string;
  easProjectId?: string;
  defaultDistributionIntent: "internal_only" | "store_bound";
  createdAt: string;
  updatedAt: string;
};

export type PreflightAppInput = Omit<PreflightApp, "createdAt" | "updatedAt">;

export type PreflightReleaseStatus = {
  app: { id: string; platforms: Array<"ios" | "android"> };
  platform: "ios" | "android";
  stage: {
    current: string | null;
    next: { key: string; owner: string; blockerReason?: string } | null;
  };
  latestBuilds: unknown[];
  submissions: Array<{ status?: string; [key: string]: unknown }>;
  buildHealth?: { status?: string; [key: string]: unknown } | null;
};

export interface PreflightClient {
  listApps(workspaceId: string): Promise<PreflightApp[]>;
  upsertApp(input: PreflightAppInput): Promise<PreflightApp>;
  readReleaseStatus(
    appId: string,
    platform: "ios" | "android",
  ): Promise<PreflightReleaseStatus | null>;
}

export type PreflightDomainAdapterConfig = {
  apiUrl: string;
  workspaceId: string;
  receiptRoot: string;
  client: PreflightClient;
};

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function safePackagePath(value: unknown): boolean {
  const path = text(value);
  return Boolean(
    path &&
    !isAbsolute(path) &&
    !path.split(/[\\/]+/).some((segment) => segment === ".."),
  );
}

function receiptFilename(key: string): string {
  return `${createHash("sha256").update(key).digest("hex")}.json`;
}

function approvedApp(proposal: ProposalV1): PreflightAppInput {
  const preview = proposal.preview;
  return {
    id: text(preview.appId)!,
    workspaceId: text(preview.workspaceId)!,
    appRuntime: (text(preview.appRuntime) ?? "expo") as "expo" | "unity",
    packageName: text(preview.packageName)!,
    packagePath: text(preview.packagePath)!,
    defaultDistributionIntent: (text(preview.defaultDistributionIntent) ??
      "store_bound") as "internal_only" | "store_bound",
    ...(text(preview.forgeGraphAppId)
      ? { forgeGraphAppId: text(preview.forgeGraphAppId) }
      : {}),
    ...(text(preview.displayName)
      ? { displayName: text(preview.displayName) }
      : {}),
    ...(text(preview.expoSlug) ? { expoSlug: text(preview.expoSlug) } : {}),
    ...(text(preview.iosBundleId)
      ? { iosBundleId: text(preview.iosBundleId) }
      : {}),
    ...(text(preview.androidPackage)
      ? { androidPackage: text(preview.androidPackage) }
      : {}),
    ...(text(preview.easProjectId)
      ? { easProjectId: text(preview.easProjectId) }
      : {}),
  };
}

const PERSISTED_IDENTITY_FIELDS = [
  "id",
  "workspaceId",
  "appRuntime",
  "packageName",
  "packagePath",
  "defaultDistributionIntent",
  "forgeGraphAppId",
  "displayName",
  "expoSlug",
  "iosBundleId",
  "easProjectId",
] as const;

function assertCompatible(
  existing: PreflightApp,
  approved: PreflightAppInput,
): void {
  for (const key of PERSISTED_IDENTITY_FIELDS) {
    const current = existing[key];
    const requested = approved[key];
    if (
      current !== undefined &&
      requested !== undefined &&
      current !== requested
    ) {
      throw new Error(
        `Preflight app identity collision: ${key} does not match the approved project`,
      );
    }
  }
}

function matchesApproved(
  existing: PreflightApp,
  approved: PreflightAppInput,
): boolean {
  return PERSISTED_IDENTITY_FIELDS.every(
    (key) => approved[key] === undefined || existing[key] === approved[key],
  );
}

export class PreflightDomainAdapter implements DomainAdapter {
  private readonly baseUrl: string;

  constructor(private readonly config: PreflightDomainAdapterConfig) {
    this.baseUrl = config.apiUrl.replace(/\/+$/, "");
  }

  async inspect(input: {
    proposalId?: string;
    externalLinkId?: string;
  }): Promise<ContextReceipt> {
    const apps = await this.config.client.listApps(this.config.workspaceId);
    return {
      destination: "preflight",
      observedAt: new Date().toISOString(),
      context: {
        ...input,
        workspaceId: this.config.workspaceId,
        appCount: apps.length,
        storeBoundCount: apps.filter(
          (app) => app.defaultDistributionIntent === "store_bound",
        ).length,
      },
    };
  }

  async validateProposal(proposal: ProposalV1): Promise<ValidationReceipt> {
    const errors: string[] = [];
    const preview = proposal.preview;
    if (proposal.status !== "approved") errors.push("Proposal is not approved");
    if (proposal.destination !== "preflight")
      errors.push("Proposal destination is not Preflight");
    if (proposal.kind !== "mobile_release")
      errors.push("Proposal kind is not mobile release");
    if (!text(preview.sourceProjectId))
      errors.push("sourceProjectId is required before Preflight registration");
    if (!/^pfapp_[A-Za-z0-9_-]+$/.test(text(preview.appId) ?? ""))
      errors.push("appId must be an existing canonical pfapp_* identity");
    if (!text(preview.workspaceId)) errors.push("workspaceId is required");
    if (
      text(preview.workspaceId) &&
      text(preview.workspaceId) !== this.config.workspaceId
    ) {
      errors.push(
        "workspaceId does not match the configured Preflight workspace",
      );
    }
    if (!text(preview.packageName)) errors.push("packageName is required");
    if (!safePackagePath(preview.packagePath))
      errors.push("packagePath must be a safe repository-relative path");
    if (!text(preview.iosBundleId) && !text(preview.androidPackage)) {
      errors.push("iosBundleId or androidPackage is required");
    }
    if (!APP_RUNTIMES.has(text(preview.appRuntime) ?? "expo")) {
      errors.push("appRuntime must be expo or unity");
    }
    if (
      !DISTRIBUTION_INTENTS.has(
        text(preview.defaultDistributionIntent) ?? "store_bound",
      )
    ) {
      errors.push("defaultDistributionIntent is invalid");
    }
    if (
      Object.keys(preview).some((key) => OPERATIONAL_RELEASE_FIELD.test(key))
    ) {
      errors.push(
        "Operational release fields for builds, submissions, publishing, or credentials are not allowed in OODA registration",
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
        `Preflight proposal validation failed: ${validation.errors.join("; ")}`,
      );
    }

    const approved = approvedApp(proposal);
    const existing = (
      await this.config.client.listApps(this.config.workspaceId)
    ).find((app) => app.id === approved.id);
    if (existing) {
      assertCompatible(existing, approved);
      if (matchesApproved(existing, approved)) {
        const receipt = this.receipt(existing, proposal, idempotencyKey);
        await this.storeReceipt(receipt);
        return receipt;
      }
    }

    let registered: PreflightApp;
    try {
      registered = await this.config.client.upsertApp(approved);
    } catch (error) {
      const reconciled = (
        await this.config.client.listApps(this.config.workspaceId)
      ).find((app) => app.id === approved.id);
      if (!reconciled || !matchesApproved(reconciled, approved)) throw error;
      registered = reconciled;
    }
    assertCompatible(registered, approved);
    if (!matchesApproved(registered, approved)) {
      throw new Error(
        "Preflight returned an app identity that cannot be reconciled safely",
      );
    }
    const receipt = this.receipt(registered, proposal, idempotencyKey);
    await this.storeReceipt(receipt);
    return receipt;
  }

  async lookupByIdempotencyKey(
    idempotencyKey: string,
  ): Promise<ExternalReceiptV1 | null> {
    const path = join(this.config.receiptRoot, receiptFilename(idempotencyKey));
    try {
      const receipt = ExternalReceiptV1Schema.parse(
        JSON.parse(await readFile(path, "utf8")),
      );
      return receipt.destination === "preflight" &&
        receipt.idempotencyKey === idempotencyKey
        ? receipt
        : null;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async readStatus(link: ExternalLinkV1): Promise<ExternalStatus> {
    const [ios, android] = await Promise.all([
      this.config.client.readReleaseStatus(link.externalId, "ios"),
      this.config.client.readReleaseStatus(link.externalId, "android"),
    ]);
    const statuses = [ios, android].filter(
      (status): status is PreflightReleaseStatus => Boolean(status),
    );
    const activeStatuses = statuses.filter((status) =>
      status.app.platforms.includes(status.platform),
    );
    const released =
      activeStatuses.length > 0 &&
      activeStatuses.every(
        (status) =>
          status.stage.current === "released" && status.stage.next === null,
      );
    return {
      status:
        statuses.length === 0
          ? "missing"
          : released
            ? "released"
            : "registered",
      observedAt: new Date().toISOString(),
      metadata: {
        ...(ios ? { ios } : {}),
        ...(android ? { android } : {}),
      },
    };
  }

  private receipt(
    app: PreflightApp,
    proposal: ProposalV1,
    idempotencyKey: string,
  ): ExternalReceiptV1 {
    return {
      destination: "preflight",
      externalType: "mobile_app",
      externalId: app.id,
      deepLink: `${this.baseUrl}/preflight/apps/${encodeURIComponent(app.id)}`,
      idempotencyKey,
      status: "accepted",
      metadata: {
        sourceProjectId: text(proposal.preview.sourceProjectId),
        workspaceId: app.workspaceId,
        packageName: app.packageName,
        packagePath: app.packagePath,
        iosBundleId: app.iosBundleId,
        androidPackage: text(proposal.preview.androidPackage),
        defaultDistributionIntent: app.defaultDistributionIntent,
        forgeGraphAppId: app.forgeGraphAppId,
      },
      recordedAt: app.createdAt,
    };
  }

  private async storeReceipt(receipt: ExternalReceiptV1): Promise<void> {
    await mkdir(this.config.receiptRoot, { recursive: true, mode: 0o700 });
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

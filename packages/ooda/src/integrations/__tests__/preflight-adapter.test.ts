import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { ExternalReceiptV1Schema, type ProposalV1 } from "../../contracts/v1";
import {
  PreflightDomainAdapter,
  type PreflightApp,
  type PreflightReleaseStatus,
} from "../preflight-adapter";

const now = "2026-08-09T15:00:00.000Z";
const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempRoots
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function receiptRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "ooda-preflight-receipts-"));
  tempRoots.push(root);
  return root;
}

function proposal(): ProposalV1 {
  return {
    id: "proposal-mobile-1",
    conversationId: "conversation-1",
    kind: "mobile_release",
    destination: "preflight",
    status: "approved",
    risk: "durable_work",
    preview: {
      sourceProjectId: "bob-project-ooda-handheld",
      appId: "pfapp_ooda_handheld_mobile",
      workspaceId: "workspace-1",
      appRuntime: "expo",
      displayName: "OODA Handheld",
      packageName: "@ooda-handheld/mobile",
      packagePath: "apps/mobile",
      expoSlug: "ooda-handheld",
      iosBundleId: "com.gmacko.ooda-handheld",
      androidPackage: "com.gmacko.ooda_handheld",
      defaultDistributionIntent: "internal_only",
      forgeGraphAppId: "forge-app-ooda-handheld",
    },
    rationale: "Register the existing mobile project without starting a build.",
    confidence: 0.9,
    policySnapshot: { version: "proposal-policy-v1" },
    version: 2,
    createdAt: now,
    updatedAt: now,
  };
}

function createdApp(): PreflightApp {
  return {
    id: "pfapp_ooda_handheld_mobile",
    workspaceId: "workspace-1",
    forgeGraphAppId: "forge-app-ooda-handheld",
    appRuntime: "expo",
    displayName: "OODA Handheld",
    packageName: "@ooda-handheld/mobile",
    packagePath: "apps/mobile",
    expoSlug: "ooda-handheld",
    iosBundleId: "com.gmacko.ooda-handheld",
    androidPackage: "com.gmacko.ooda_handheld",
    defaultDistributionIntent: "internal_only",
    createdAt: now,
    updatedAt: now,
  };
}

describe("PreflightDomainAdapter", () => {
  it("registers one identified mobile project and reconciles by durable receipt", async () => {
    const apps: PreflightApp[] = [];
    const upsert = vi.fn(async (input) => {
      const app = { ...createdApp(), ...input };
      apps.push(app);
      return app;
    });
    const adapter = new PreflightDomainAdapter({
      apiUrl: "https://preflight.example",
      workspaceId: "workspace-1",
      receiptRoot: await receiptRoot(),
      client: {
        async listApps() {
          return apps;
        },
        upsertApp: upsert,
        async readReleaseStatus() {
          return null;
        },
      },
    });

    const first = await adapter.commit(proposal(), "delivery-mobile-1");
    const replay = await adapter.commit(proposal(), "delivery-mobile-1");

    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "pfapp_ooda_handheld_mobile",
        workspaceId: "workspace-1",
        packageName: "@ooda-handheld/mobile",
        packagePath: "apps/mobile",
        defaultDistributionIntent: "internal_only",
      }),
    );
    expect(first).toMatchObject({
      destination: "preflight",
      externalType: "mobile_app",
      externalId: "pfapp_ooda_handheld_mobile",
      status: "accepted",
      idempotencyKey: "delivery-mobile-1",
      metadata: { sourceProjectId: "bob-project-ooda-handheld" },
    });
    expect(ExternalReceiptV1Schema.parse(first)).toEqual(first);
    expect(replay).toEqual(first);
  });

  it("requires project identity and rejects build, submit, publish, and credential fields", async () => {
    const adapter = new PreflightDomainAdapter({
      apiUrl: "https://preflight.example",
      workspaceId: "workspace-1",
      receiptRoot: await receiptRoot(),
      client: {
        async listApps() {
          return [];
        },
        async upsertApp() {
          throw new Error("must not create");
        },
        async readReleaseStatus() {
          return null;
        },
      },
    });
    const unsafe = proposal();
    delete unsafe.preview.sourceProjectId;
    unsafe.preview.queueBuild = true;
    unsafe.preview.submitRelease = true;
    unsafe.preview.publish = true;
    unsafe.preview.credentials = { token: "must-not-pass" };

    await expect(adapter.validateProposal(unsafe)).resolves.toMatchObject({
      valid: false,
      errors: expect.arrayContaining([
        expect.stringMatching(/sourceProjectId is required/i),
        expect.stringMatching(/operational release fields/i),
      ]),
    });
  });

  it("reads canonical iOS and Android release ladders without mutating them", async () => {
    const release = (platform: "ios" | "android"): PreflightReleaseStatus => ({
      app: {
        id: "pfapp_ooda_handheld_mobile",
        platforms: ["ios", "android"],
      },
      platform,
      stage: {
        current: platform === "ios" ? "store_build" : "identity",
        next: { key: "testflight", owner: "preflight" },
      },
      latestBuilds: [],
      submissions: [],
      buildHealth: { status: "ok" },
    });
    const readReleaseStatus = vi.fn(async (_id, platform) => release(platform));
    const adapter = new PreflightDomainAdapter({
      apiUrl: "https://preflight.example",
      workspaceId: "workspace-1",
      receiptRoot: await receiptRoot(),
      client: {
        async listApps() {
          return [createdApp()];
        },
        async upsertApp() {
          return createdApp();
        },
        readReleaseStatus,
      },
    });

    await expect(
      adapter.readStatus({
        id: "link-1",
        proposalId: "proposal-mobile-1",
        destination: "preflight",
        externalType: "mobile_app",
        externalId: "pfapp_ooda_handheld_mobile",
        deepLink:
          "https://preflight.example/preflight/apps/pfapp_ooda_handheld_mobile",
        idempotencyKey: "delivery-mobile-1",
        status: "active",
        createdAt: now,
        updatedAt: now,
      }),
    ).resolves.toMatchObject({
      status: "registered",
      metadata: {
        ios: { stage: { current: "store_build" } },
        android: { stage: { current: "identity" } },
      },
    });
    expect(readReleaseStatus).toHaveBeenCalledTimes(2);
  });
});

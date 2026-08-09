import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { ExternalReceiptV1Schema, type ProposalV1 } from "../../contracts/v1";
import {
  CreatorDomainAdapter,
  type CreatorProject,
  type CreatorScaffoldInput,
} from "../creator-adapter";

const now = "2026-08-09T12:00:00.000Z";

function proposal(projectPath: string): ProposalV1 {
  return {
    id: "proposal-content-1",
    conversationId: "conversation-1",
    kind: "content_project",
    destination: "creator",
    status: "approved",
    risk: "external_write",
    preview: {
      projectPath,
      title: "OODA: From Conversation to Work",
      format: "long",
      audience: "Builders managing several projects with LLMs.",
      promise: "See one idea retain its context all the way into shipped work.",
      fabforgeProject: "gmackie/ooda-handheld",
    },
    rationale: "Create the explicitly approved authored video workspace.",
    confidence: 0.9,
    policySnapshot: { version: "proposal-policy-v1" },
    version: 2,
    createdAt: now,
    updatedAt: now,
  };
}

describe("CreatorDomainAdapter", () => {
  it("scaffolds and registers one approved manifest while preserving FabForge as a pointer", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "ooda-creator-projects-"));
    const receiptRoot = await mkdtemp(join(tmpdir(), "ooda-creator-receipts-"));
    const projectPath = join(projectRoot, "ooda-conversation-to-work");
    const projects: CreatorProject[] = [];
    const scaffold = vi.fn(async (input: CreatorScaffoldInput) => {
      await mkdir(input.projectPath, { recursive: true });
      await writeFile(
        join(input.projectPath, "video.project.json"),
        `${JSON.stringify(
          {
            version: "1",
            id: "ooda-from-conversation-to-work",
            title: input.title,
            format: input.format,
            status: "idea",
            why: {
              audience: input.audience,
              promise: input.promise,
              stakes: "",
            },
            sources: input.fabforgeProject
              ? [
                  {
                    kind: "fabforge",
                    project: input.fabforgeProject,
                    units: [],
                  },
                ]
              : [],
            sponsors: [],
            assets: {
              script: "script.md",
              storyboard: "storyboard/",
              shotList: "SHOTS.md",
            },
            board: "board.json",
            publish: { channel: null, targetDate: null, url: null },
          },
          null,
          2,
        )}\n`,
        "utf8",
      );
    });
    const adapter = new CreatorDomainAdapter({
      apiUrl: "https://creator.example",
      projectRoot,
      receiptRoot,
      scaffold,
      client: {
        async listProjects() {
          return projects;
        },
        async registerLocalProject(path) {
          const created: CreatorProject = {
            id: "creator-project-1",
            manifestId: "ooda-from-conversation-to-work",
            sourceKind: "local",
            sourcePath: path,
            title: "OODA: From Conversation to Work",
            status: "idea",
            createdAt: now,
          };
          projects.push(created);
          return created;
        },
      },
    });

    const first = await adapter.commit(
      proposal(projectPath),
      "delivery-content-1",
    );
    const replay = await adapter.commit(
      proposal(projectPath),
      "delivery-content-1",
    );
    const manifest = JSON.parse(
      await readFile(join(projectPath, "video.project.json"), "utf8"),
    ) as Record<string, unknown>;

    expect(scaffold).toHaveBeenCalledTimes(1);
    expect(manifest.sources).toEqual([
      { kind: "fabforge", project: "gmackie/ooda-handheld", units: [] },
    ]);
    expect(manifest).not.toHaveProperty("facts");
    expect(first).toMatchObject({
      destination: "creator",
      externalType: "video_project",
      externalId: "creator-project-1",
      idempotencyKey: "delivery-content-1",
      status: "accepted",
      metadata: {
        manifestId: "ooda-from-conversation-to-work",
        status: "idea",
      },
    });
    expect(ExternalReceiptV1Schema.parse(first)).toEqual(first);
    expect(replay).toEqual(first);
  });

  it("rejects path escape and copied FabForge facts before any write", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "ooda-creator-projects-"));
    const receiptRoot = await mkdtemp(join(tmpdir(), "ooda-creator-receipts-"));
    const scaffold = vi.fn();
    const adapter = new CreatorDomainAdapter({
      apiUrl: "https://creator.example",
      projectRoot,
      receiptRoot,
      scaffold,
      client: {
        async listProjects() {
          return [];
        },
        async registerLocalProject() {
          throw new Error("must not register");
        },
      },
    });
    const outside = proposal(join(projectRoot, "..", "escaped-video"));
    const copiedFacts = proposal(join(projectRoot, "safe-video"));
    copiedFacts.preview.fabforgeFacts = { partCount: 42 };

    await expect(adapter.validateProposal(outside)).resolves.toMatchObject({
      valid: false,
      errors: [expect.stringMatching(/project root/i)],
    });
    await expect(adapter.validateProposal(copiedFacts)).resolves.toMatchObject({
      valid: false,
      errors: [expect.stringMatching(/facts/i)],
    });
    expect(scaffold).not.toHaveBeenCalled();
  });

  it("does not let an existing registration bypass approved-manifest verification", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "ooda-creator-projects-"));
    const receiptRoot = await mkdtemp(join(tmpdir(), "ooda-creator-receipts-"));
    const projectPath = join(projectRoot, "existing-video");
    await mkdir(projectPath);
    await writeFile(
      join(projectPath, "video.project.json"),
      JSON.stringify({
        version: "1",
        id: "other-video",
        title: "A different unapproved title",
        format: "long",
        status: "idea",
        sources: [],
      }),
      "utf8",
    );
    const adapter = new CreatorDomainAdapter({
      apiUrl: "https://creator.example",
      projectRoot,
      receiptRoot,
      scaffold: vi.fn(),
      client: {
        async listProjects() {
          return [
            {
              id: "creator-project-existing",
              manifestId: "other-video",
              sourceKind: "local" as const,
              sourcePath: await realpath(projectPath),
              title: "A different unapproved title",
              status: "idea",
            },
          ];
        },
        async registerLocalProject() {
          throw new Error("must not register");
        },
      },
    });

    await expect(
      adapter.commit(proposal(projectPath), "delivery-content-existing"),
    ).rejects.toThrow(/does not match the approved preview/i);
  });
});

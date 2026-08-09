import { describe, expect, it, vi } from "vitest";

import { ExternalReceiptV1Schema, type ProposalV1 } from "../../contracts/v1";
import { VeritasDomainAdapter, type VeritasProject } from "../veritas-adapter";

const now = "2026-08-09T14:00:00.000Z";

function proposal(): ProposalV1 {
  return {
    id: "proposal-hardware-1",
    conversationId: "conversation-1",
    kind: "hardware_validation",
    destination: "veritas",
    status: "approved",
    risk: "durable_work",
    preview: {
      name: "OODA handheld",
      description: "Register the firmware project for release validation.",
      firmwareRepoUrl: "https://github.com/gmackie/ooda-handheld-firmware",
      pcbRepoUrl: "https://github.com/gmackie/ooda-handheld-pcb",
      targetHardware: "ESP32-S3 handheld prototype",
    },
    rationale: "Create project identity without inventing validation evidence.",
    confidence: 0.9,
    policySnapshot: { version: "proposal-policy-v1" },
    version: 2,
    createdAt: now,
    updatedAt: now,
  };
}

describe("VeritasDomainAdapter", () => {
  it("creates one project identity and reconciles retries by a deterministic marker", async () => {
    const projects: VeritasProject[] = [];
    const create = vi.fn(async (input) => {
      const project: VeritasProject = {
        id: "project-1",
        orgId: "org-1",
        name: input.name,
        slug: input.slug,
        description: input.description,
        firmwareRepoUrl: input.firmwareRepoUrl,
        pcbRepoUrl: input.pcbRepoUrl,
        targetHardware: input.targetHardware,
        autoValidate: false,
        createdAt: now,
        updatedAt: now,
      };
      projects.push(project);
      return project;
    });
    const adapter = new VeritasDomainAdapter({
      apiUrl: "https://veritas.example",
      client: {
        async listProjects(search) {
          return search
            ? projects.filter(
                (project) =>
                  project.slug.includes(search) ||
                  project.name.includes(search),
              )
            : projects;
        },
        createProject: create,
        async getProject(id) {
          return projects.find((project) => project.id === id) ?? null;
        },
      },
    });

    const first = await adapter.commit(proposal(), "delivery-hardware-1");
    const replay = await adapter.commit(proposal(), "delivery-hardware-1");

    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "OODA handheld",
        slug: "ooda-delivery-hardware-1",
        firmwareRepoUrl: "https://github.com/gmackie/ooda-handheld-firmware",
        pcbRepoUrl: "https://github.com/gmackie/ooda-handheld-pcb",
        targetHardware: "ESP32-S3 handheld prototype",
        description: expect.stringContaining(
          "OODA delivery: delivery-hardware-1",
        ),
      }),
    );
    expect(first).toMatchObject({
      destination: "veritas",
      externalType: "hardware_project",
      externalId: "project-1",
      status: "accepted",
      idempotencyKey: "delivery-hardware-1",
      metadata: { autoValidate: false },
    });
    expect(ExternalReceiptV1Schema.parse(first)).toEqual(first);
    expect(replay).toEqual(first);
  });

  it("rejects destination-owned device, station, evidence, and approval mutations", async () => {
    const adapter = new VeritasDomainAdapter({
      apiUrl: "https://veritas.example",
      client: {
        async listProjects() {
          return [];
        },
        async createProject() {
          throw new Error("must not create");
        },
        async getProject() {
          return null;
        },
      },
    });
    const unsafe = proposal();
    unsafe.preview.deviceId = "device-1";
    unsafe.preview.stationId = "station-1";
    unsafe.preview.testEvidence = { verdict: "pass" };
    unsafe.preview.releaseApproved = true;

    await expect(adapter.validateProposal(unsafe)).resolves.toMatchObject({
      valid: false,
      errors: [expect.stringMatching(/destination-owned/i)],
    });
  });

  it("refuses to claim an unrelated project with the deterministic slug", async () => {
    const collision: VeritasProject = {
      id: "project-existing",
      orgId: "org-1",
      name: "Existing project",
      slug: "ooda-delivery-hardware-1",
      description: "Created independently.",
      firmwareRepoUrl: "https://github.com/example/unrelated",
      autoValidate: false,
      createdAt: now,
      updatedAt: now,
    };
    const adapter = new VeritasDomainAdapter({
      apiUrl: "https://veritas.example",
      client: {
        async listProjects() {
          return [collision];
        },
        async createProject() {
          throw new Error("must not create");
        },
        async getProject() {
          return collision;
        },
      },
    });

    await expect(
      adapter.commit(proposal(), "delivery-hardware-1"),
    ).rejects.toThrow(/slug collision/i);
  });
});

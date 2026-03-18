import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const createPlanningCallerMock = vi.fn();
const notFoundMock = vi.fn();

vi.mock("next/navigation", () => ({
  notFound: notFoundMock,
}));

vi.mock("@bob/ui/badge", () => ({
  Badge: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("span", null, children),
}));

vi.mock("~/components/dashboard", () => ({
  RepositoryPanel: () =>
    React.createElement("div", { "data-testid": "repository-panel" }, "RepositoryPanel"),
}));

vi.mock("~/components/planning/start-planning-button", () => ({
  StartPlanningButton: () =>
    React.createElement("button", null, "Start planning"),
}));

vi.mock("~/components/work-items/create-work-item-button", () => ({
  CreateWorkItemButton: () =>
    React.createElement("button", null, "Create work item"),
}));

vi.mock("~/components/projects/project-detail-tabs", () => ({
  ProjectDetailTabs: () =>
    React.createElement("div", { "data-testid": "project-tabs" }, "Project tabs"),
}));

vi.mock("~/lib/planning/server", () => ({
  createPlanningCaller: createPlanningCallerMock,
}));

describe("project page", () => {
  beforeEach(() => {
    notFoundMock.mockReset();
    createPlanningCallerMock.mockReset();

    createPlanningCallerMock.mockResolvedValue({
      project: {
        get: vi.fn(async () => ({
          project: {
            id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            name: "Acme App",
            key: "ACME",
            status: "in_progress",
            description: "A known Gmacko app",
            color: "#0f172a",
            automationSettings: {
              reactFrontend: true,
            },
          },
          counts: {
            issues: 1,
            tasks: 2,
            epics: 1,
            active: 2,
          },
          linkedRepository: {
            id: "repo-1",
            name: "acme-app",
            path: "/tmp/acme-app",
            remoteProvider: "github",
            remoteOwner: "acme",
            remoteName: "acme-app",
            remoteUrl: "git@github.com:acme/acme-app.git",
          },
          capabilities: {
            template: {
              slug: "create-gmacko-app",
              label: "create-gmacko-app",
              confidence: "high",
              frontendApps: ["apps/nextjs"],
              evidence: [
                "apps/nextjs",
                "packages/ui",
                "packages/api",
                "packages/db",
                "docs/ai",
                ".claude/skills/gstack",
                "gmacko.integrations.json",
              ],
              hasAiWorkflow: true,
              hasClaudeGstack: true,
              hasRepoSkill: true,
              hasStorybook: true,
              hasIntegrationManifest: true,
              hasPlaywright: true,
              hasMaestro: true,
            },
          },
        })),
      },
      workItems: {
        list: vi.fn(async () => []),
      },
    });
  });

  it("renders the detected create-gmacko-app workflow panel", async () => {
    const module = await import("../(dashboard)/projects/[projectId]/page");

    const element = await module.default({
      params: Promise.resolve({
        projectId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      }),
    });
    const markup = renderToStaticMarkup(element);

    expect(markup).toContain("create-gmacko-app detected");
    expect(markup).toContain("Gmacko app");
    expect(markup).toContain("gstack");
    expect(markup).toContain("docs/ai");
    expect(markup).toContain("Recommended next move");
    expect(markup).toContain("Tell Bob");
    expect(markup).toContain("Feature development");
    expect(markup).toContain("Playwright");
    expect(markup).toContain("Maestro");
    expect(markup).toContain("apps/nextjs");
  });
});
